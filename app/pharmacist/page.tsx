"use client";
import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ThemeCtx, LIGHT, DARK } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { Medicine } from "@/lib/types";

import Sidebar                from "./components/Sidebar";
import Topbar                 from "./components/Topbar";
import Toast                  from "./components/Toast";
import RestockModal           from "./components/modal/RestockModal";
import ViewRequestsModal      from "./components/modal/ViewRequestModal";
import RestockConfirmListener from "./components/RestockConfirmListener";
import Dashboard              from "./components/pages/Dashboard";
import MedicineStockPage      from "./components/pages/MedicineStockPage";
import PharmacistSettings     from "./components/pages/PharmacistSettings";

export default function Home() {
  const router        = useRouter();
  const searchParams  = useSearchParams();

  const [dark, setDark]                         = useState(false);
  const [activePage, setActivePage]             = useState("dashboard");
  const [settingsTab, setSettingsTab]           = useState<"profile" | "password">("profile");
  const [restockType, setRestockType]           = useState<"drugs" | "supplies" | null>(null);
  const [showViewRequests, setShowViewRequests] = useState(false);
  const [toast, setToast]                       = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [medicines, setMedicines]               = useState<Medicine[]>([]);
  const [totalCount, setTotalCount]             = useState(0);

  const [pharmacistName, setPharmacistName]     = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const t = dark ? DARK : LIGHT;

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("users")
        .select("username")
        .eq("user_id", uid)
        .maybeSingle();
      if (data?.username) setPharmacistName(data.username);
    })();
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { medicine, qty, type } = (e as CustomEvent).detail ?? {};
      const label = medicine ? `${medicine} (${qty} ${type ?? ""})` : "item";
      showToast(`✓ Restock confirmed — ${label} added to inventory.`, "success");
    };
    window.addEventListener("restockAutoAdded", handler);
    return () => window.removeEventListener("restockAutoAdded", handler);
  }, []);

  useEffect(() => {
    const page = searchParams?.get("page");
    const tab  = searchParams?.get("tab");
    if (page === "settings") {
      setActivePage("settings");
      setSettingsTab(tab === "password" ? "password" : "profile");
    } else if (page === "medicine-stock") {
      setActivePage("stock");
    } else if (page === "dashboard" || page === "prescriptions") {
      setActivePage("dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const urlPage = activePage === "stock" ? "medicine-stock" : activePage;
    const qs = activePage === "settings" ? `?page=settings&tab=${settingsTab}` : `?page=${urlPage}`;
    router.replace(`/pharmacist${qs}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, settingsTab]);

  useEffect(() => {
    const open = () => setShowViewRequests(true);
    window.addEventListener("openViewRequests", open);
    return () => window.removeEventListener("openViewRequests", open);
  }, []);

  const handleNavigate = (page: string) => {
    if (page === "settings") {
      setActivePage("settings");
      setSettingsTab("profile");
    } else if (page === "medicine-stock") {
      setActivePage("stock");
    } else if (page === "prescriptions") {
      setActivePage("dashboard");
    } else {
      setActivePage(page);
    }
  };

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
  }, []);

  const fetchDashboardMedicines = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("pharma_medicines")
        .select("*")
        .eq("archived", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setMedicines((data as Medicine[]) ?? []);
      setTotalCount((data as Medicine[])?.length ?? 0);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => { fetchDashboardMedicines(); }, [fetchDashboardMedicines]);

  return (
    <ThemeCtx.Provider value={{ t, dark, toggle: () => setDark(d => !d) }}>
      <div style={{
        display: "flex", height: "100vh", overflow: "hidden",
        fontFamily: "'Nunito', sans-serif", background: t.appBg,
        transition: "background 0.2s",
      }}>
        <Sidebar
          active={activePage}
          setActive={setActivePage}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
          darkMode={dark}
        />

        <div style={{
          display: "flex", flexDirection: "column", flex: 1, overflow: "hidden",
          transition: "margin-left .2s ease",
        }}>
          <Topbar onNavigate={handleNavigate} />

          <main style={{
            flex: 1, overflowY: "auto", padding: "18px 20px",
            background: t.appBg, boxSizing: "border-box", transition: "background 0.2s",
          }}>
            {activePage === "dashboard" && (
              <Dashboard
                medicines={medicines}
                totalCount={totalCount}
                onSendRequest={(type) => setRestockType(type)}
                onOpenPrescriptions={() => setActivePage("dashboard")}
                onViewRequests={() => setShowViewRequests(true)}
                onStockChanged={fetchDashboardMedicines}
              />
            )}
            {activePage === "stock" && (
              <MedicineStockPage
                onToast={showToast}
                onMedicineAdded={fetchDashboardMedicines}
                darkMode={dark}
              />
            )}
            {activePage === "settings" && (
              <PharmacistSettings initialTab={settingsTab} />
            )}
          </main>
        </div>

        {pharmacistName && (
          <RestockConfirmListener
            pharmacistName={pharmacistName}
            onStockAdded={fetchDashboardMedicines}
          />
        )}

        {restockType && (
          <RestockModal
            requestType={restockType}
            onClose={() => setRestockType(null)}
            onToast={showToast}
          />
        )}
        {showViewRequests && (
          <ViewRequestsModal
            onClose={() => setShowViewRequests(false)}
            onToast={showToast}
          />
        )}
        {toast && (
          <Toast message={toast.msg} type={toast.type} onDone={() => setToast(null)} />
        )}
      </div>
    </ThemeCtx.Provider>
  );
}