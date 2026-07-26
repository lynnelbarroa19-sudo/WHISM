"use client";
import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ThemeCtx, LIGHT, DARK } from "./lib/pharmacy";

import Sidebar               from "./components/Sidebar";
import Topbar, { Toast }     from "./components/Topbar";
import { PharmacistSettings } from "./components/Settings";
import Dashboard              from "./components/Dashboard";
import MedicineStockPage      from "./components/Inventory";
import AddMedicinePage        from "./components/AddMedicinePage";
import RequestMedicinePage    from "./components/RequestMedicinePage";
import DispenseMedicinePage   from "./components/DispenseMedicinePage";

export default function Home() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [dark, setDark]               = useState(false);
  const [activePage, setActivePage]   = useState("dashboard");
  const [settingsTab, setSettingsTab] = useState<"profile" | "password">("profile");
  const [toast, setToast]             = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [totalCount, setTotalCount]   = useState(0);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const t = dark ? DARK : LIGHT;

  useEffect(() => {
    const handler = (e: Event) => {
      const { medicine, qty, type } = (e as CustomEvent).detail ?? {};
      const label = medicine ? `${medicine} (${qty} ${type ?? ""})` : "item";
      showToast(`✓ Restock confirmed — ${label} added to inventory.`, "success");
      fetchDashboardCount();
    };
    window.addEventListener("restockAutoAdded", handler);
    return () => window.removeEventListener("restockAutoAdded", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const page = searchParams?.get("page");
    const tab  = searchParams?.get("tab");
    if (page === "settings") {
      setActivePage("settings");
      setSettingsTab(tab === "password" ? "password" : "profile");
    } else if (page === "medicine-stock") {
      setActivePage("stock");
    } else if (page === "add-medicine") {
      setActivePage("addmedicine");
    } else if (page === "request-medicine") {
      setActivePage("requestmedicine");
    } else if (page === "dispensemedicine") {
      setActivePage("dispensemedicine");
    } else if (page === "dashboard" || page === "prescriptions") {
      setActivePage("dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const URL_PAGE_MAP: Record<string, string> = {
      stock:            "medicine-stock",
      addmedicine:      "add-medicine",
      requestmedicine:  "request-medicine",
      dispensemedicine: "dispensemedicine",
    };
    const urlPage = URL_PAGE_MAP[activePage] ?? activePage;
    const qs = activePage === "settings" ? `?page=settings&tab=${settingsTab}` : `?page=${urlPage}`;
    router.replace(`/pharmacist${qs}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, settingsTab]);

  // Restock notifications from Topbar route here — RequestMedicinePage
  // already shows full history + a per-request detail popup.
  useEffect(() => {
    const open = () => setActivePage("requestmedicine");
    window.addEventListener("openViewRequests", open);
    return () => window.removeEventListener("openViewRequests", open);
  }, []);

  const handleNavigate = (page: string, tab?: "profile" | "password") => {
    if (page === "settings") {
      setActivePage("settings");
      setSettingsTab(tab === "password" ? "password" : "profile");
    } else if (page === "medicine-stock") {
      setActivePage("stock");
    } else if (page === "add-medicine") {
      setActivePage("addmedicine");
    } else if (page === "request-medicine") {
      setActivePage("requestmedicine");
    } else if (page === "prescriptions") {
      setActivePage("dashboard");
    } else {
      setActivePage(page);
    }
  };

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
  }, []);

  // Dashboard reads its own aggregate stock via fetchStockSummary(); this
  // only tracks the "Total Medicine" stat card count from the catalog table.
  const fetchDashboardCount = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from("pharma_medicines")
        .select("medicine_id", { count: "exact", head: true })
        .eq("is_archived", false);
      if (error) throw error;
      setTotalCount(count ?? 0);
    } catch {
      // silently fail — dashboard just shows 0 until the next successful fetch
    }
  }, []);

  useEffect(() => { fetchDashboardCount(); }, [fetchDashboardCount]);

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
              <Dashboard totalCount={totalCount} />
            )}
            {activePage === "addmedicine" && (
              <AddMedicinePage onToast={showToast} />
            )}
            {activePage === "requestmedicine" && (
              <RequestMedicinePage onToast={showToast} />
            )}
            {activePage === "stock" && (
              <MedicineStockPage
                onToast={showToast}
                onMedicineAdded={fetchDashboardCount}
              />
            )}
            {activePage === "dispensemedicine" && (
              <DispenseMedicinePage onToast={showToast} />
            )}
            {activePage === "settings" && (
              <PharmacistSettings initialTab={settingsTab} />
            )}
          </main>
        </div>

        {toast && (
          <Toast message={toast.msg} type={toast.type} onDone={() => setToast(null)} />
        )}
      </div>
    </ThemeCtx.Provider>
  );
}