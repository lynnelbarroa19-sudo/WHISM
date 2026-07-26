"use client";
import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { LayoutDashboard, Send, Package, ClipboardList, User, LogOut, Activity } from "lucide-react";

/* ══════════════════════════════════════════
   INJECT STYLES
══════════════════════════════════════════ */
const injectStyles = () => {
  if (typeof document === "undefined") return;
  const id = "smartrhu-phar-sidebar-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800;900&display=swap');

    .phar-sidebar, .phar-sidebar * { font-family: 'Nunito', sans-serif !important; }
    .phar-sidebar::-webkit-scrollbar { display: none; }
    .phar-sidebar { scrollbar-width: none; -ms-overflow-style: none; }

    .phar-nav-btn { position: relative; overflow: hidden; }
    .phar-nav-btn::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(22,163,74,0.1) 0%, transparent 100%);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .phar-nav-btn:hover::after { opacity: 1; }
    .phar-nav-btn.phar-active-btn::after { display: none; }

    .phar-ripple {
      position: absolute;
      border-radius: 50%;
      background: rgba(26,122,26,0.22);
      pointer-events: none;
      transform: scale(0);
      animation: phar-ripple-anim 0.45s ease-out forwards;
    }
    @keyframes phar-ripple-anim { to { transform: scale(4); opacity: 0; } }
    .phar-ripple-red { background: rgba(229,62,62,0.18); }

    .phar-slide-in { animation: phar-slideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) both; }
    @keyframes phar-slideIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }

    .phar-cal-day:hover { background: rgba(26,122,26,0.12) !important; border-radius: 6px; }

    .phar-logout-icon { transition: transform 0.2s ease; }
    .phar-logout-btn:hover .phar-logout-icon { transform: translateX(3px); }

    .phar-tooltip {
      position: absolute; left: calc(100% + 12px); top: 50%;
      transform: translateY(-50%) translateX(-4px);
      background: #16a34a; color: #ffffff; font-size: 11px; font-weight: 500;
      padding: 5px 10px; border-radius: 7px; white-space: nowrap; pointer-events: none;
      opacity: 0; transition: opacity 0.18s ease, transform 0.18s ease;
      box-shadow: 0 4px 12px rgba(26,122,26,0.25);
      font-family: 'Nunito', sans-serif; z-index: 999;
    }
    .phar-tooltip::before {
      content: ''; position: absolute; right: 100%; top: 50%; transform: translateY(-50%);
      border: 5px solid transparent; border-right-color: #16a34a;
    }
    .phar-nav-btn:hover .phar-tooltip, .phar-logout-btn:hover .phar-tooltip { opacity: 1; transform: translateY(-50%) translateX(0); }

    .phar-toggle-btn { transition: background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease; }
    .phar-toggle-btn:hover { background: #16a34a !important; transform: translateY(-50%) scale(1.08); }

    .phar-nav-btn, .phar-logout-btn, .phar-cal-nav-btn {
      transition: background 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease, color 0.16s ease;
    }
    .phar-nav-btn:not(.phar-active-btn):hover, .phar-logout-btn:hover { transform: translateX(2px); }
    .phar-cal-nav-btn:hover { transform: scale(1.08); }
  `;
  document.head.appendChild(style);
};
if (typeof window !== "undefined") injectStyles();

/* ══════════════════════════════════════════
   THEME
══════════════════════════════════════════ */
function usePharTheme(darkMode: boolean) {
  return {
    green: "#16a34a", greenDark: "#0d3b1f", greenMid: "#166534", greenLight: "#dcfce7", mint: "#4ade80",
    bg: darkMode ? "#061a0d" : "#f0f7f2",
    surface: darkMode ? "#0d2516" : "#ffffff",
    surface2: darkMode ? "#0f2e1a" : "#f6faf7",
    border: darkMode ? "rgba(74,222,128,0.1)" : "rgba(22,163,74,0.15)",
    text: darkMode ? "#e2f5e9" : "#0a2912",
    text2: darkMode ? "#9abea6" : "#4b6557",
    text3: darkMode ? "#4b6557" : "#9ca3af",
    shadow: darkMode ? "0 2px 16px rgba(0,0,0,0.4)" : "0 2px 16px rgba(13,59,31,0.08)",
    accentSoft: darkMode ? "rgba(74,222,128,0.12)" : "#dcfce7",
  };
}

/* ══════════════════════════════════════════
   PH HOLIDAYS
══════════════════════════════════════════ */
const PH_HOLIDAYS: Record<string, string> = {
  "0-1": "New Year's Day", "1-25": "EDSA People Power Anniversary", "3-9": "Araw ng Kagitingan",
  "4-1": "Labor Day", "5-12": "Independence Day", "7-21": "Ninoy Aquino Day", "7-25": "National Heroes Day",
  "9-31": "All Saints' Day Eve", "10-1": "All Saints' Day", "10-30": "Bonifacio Day",
  "11-8": "Feast of the Immaculate Conception", "11-24": "Christmas Eve", "11-25": "Christmas Day",
  "11-30": "Rizal Day", "11-31": "New Year's Eve",
};

/* ══════════════════════════════════════════
   MINI CALENDAR
══════════════════════════════════════════ */
function MiniCalendar({ darkMode }: { darkMode: boolean }) {
  const C = usePharTheme(darkMode);
  const [currentDate, setCurrentDate] = useState(new Date());
  const today = new Date();
  const month = currentDate.toLocaleString("default", { month: "long" }).toUpperCase();
  const year = currentDate.getFullYear();
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const days = ["S", "M", "T", "W", "T", "F", "S"];

  const navBtnStyle: CSSProperties = {
    background: C.accentSoft, border: "none", borderRadius: 6, width: 22, height: 22,
    cursor: "pointer", color: darkMode ? C.mint : C.green,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, fontWeight: 700, lineHeight: 1,
  };
  const isHoliday = (m: number, d: number) => PH_HOLIDAYS[`${m}-${d}`];

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button className="phar-cal-nav-btn" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} style={navBtnStyle}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1, color: darkMode ? C.mint : C.green }}>{month} {year}</span>
        <button className="phar-cal-nav-btn" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} style={navBtnStyle}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 1, textAlign: "center" }}>
        {days.map((d, i) => <div key={i} style={{ fontWeight: 700, color: "#9ca3af", padding: "2px 0", fontSize: 9, letterSpacing: 0.5 }}>{d}</div>)}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
          const isToday = day === today.getDate() && currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
          const isSun = date.getDay() === 0;
          const holiday = isHoliday(currentDate.getMonth(), day);
          return (
            <div key={day} className="phar-cal-day" title={holiday || undefined} style={{
              padding: "3px 0", borderRadius: 6, cursor: holiday ? "help" : "pointer",
              background: isToday ? `linear-gradient(135deg, ${C.green}, ${C.mint})` : "transparent",
              color: isToday ? "#ffffff" : (holiday || isSun ? "#dc2626" : C.text2),
              fontWeight: isToday || holiday || isSun ? 700 : 400, fontSize: 10,
              boxShadow: isToday ? `0 2px 8px ${C.green}44` : "none",
            }}>{day}</div>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  active: string;
  setActive: (page: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  darkMode?: boolean;
};

/* Menu label -> page key. Labels match the reference nav exactly. */
const MENU_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, section: "Menu" },
  { label: "Medicine Inventory", icon: Package, section: "Menu" },
  { label: "Dispense Medicine", icon: ClipboardList, section: "Menu" },
  { label: "Request Medicine", icon: Send, section: "Menu" },
  { label: "Profile", icon: User, section: "General" },
] as const;

const LABEL_TO_KEY: Record<string, string> = {
  "Dashboard": "dashboard",
  "Request Medicine": "requestmedicine",
  "Medicine Inventory": "stock",
  "Dispense Medicine": "dispensemedicine",
  "Profile": "settings",
};

export default function Sidebar({ active, setActive, collapsed, onToggleCollapsed, darkMode = false }: Props) {
  const router = useRouter();
  const { logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const C = usePharTheme(darkMode);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const dashRef = useRef<HTMLButtonElement>(null);
  const [togglePos, setTogglePos] = useState(135);

  useEffect(() => {
    const el = dashRef.current;
    const wrap = wrapperRef.current;
    if (!el || !wrap) return;
    const eR = el.getBoundingClientRect();
    const wR = wrap.getBoundingClientRect();
    setTogglePos(eR.top - wR.top + eR.height / 2);
  }, [collapsed]);

  const spawnRipple = useCallback((e: React.MouseEvent, ref: React.RefObject<HTMLElement>, extraClass = "") => {
    const btn = ref.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const r = document.createElement("span");
    r.className = `phar-ripple${extraClass ? ` ${extraClass}` : ""}`;
    r.style.width = size + "px";
    r.style.height = size + "px";
    r.style.left = (e.clientX - rect.left - size / 2) + "px";
    r.style.top = (e.clientY - rect.top - size / 2) + "px";
    btn.appendChild(r);
    setTimeout(() => r.remove(), 500);
  }, []);

  async function handleLogout() {
    setShowLogoutModal(false);
    await logout();
    router.push("/login");
  }

  const labelToKey = (label: string): string => LABEL_TO_KEY[label] ?? label.toLowerCase().replace(/ /g, "");

  const NavBtn = ({ label, icon: Icon, forwardedRef }: {
    label: string; icon: React.ElementType; forwardedRef?: React.RefObject<HTMLButtonElement | null>;
  }) => {
    const key = labelToKey(label);
    const on = active === key;
    const hovered = hoveredItem === label;
    const btnRef = useRef<HTMLButtonElement>(null);

    const setRefs = (node: HTMLButtonElement | null) => {
      (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
      if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
    };

    const handlePageClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      spawnRipple(e, btnRef as React.RefObject<HTMLElement>);
      setActive(key);
    };

    return (
      <button
        ref={setRefs}
        className={`phar-nav-btn${on ? " phar-active-btn" : ""}`}
        onClick={handlePageClick}
        onMouseEnter={() => setHoveredItem(label)}
        onMouseLeave={() => setHoveredItem(null)}
        title={collapsed ? label : undefined}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          gap: collapsed ? 0 : 10, justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "9px" : "9px 14px", borderRadius: 12, marginBottom: 3,
          background: on ? `linear-gradient(135deg, ${C.greenMid} 0%, ${C.green} 100%)` : hovered ? C.accentSoft : "transparent",
          color: on ? "#ffffff" : C.text2, border: "none", cursor: "pointer", fontSize: 13,
          fontWeight: on ? 600 : 400, position: "relative", textAlign: "left",
          boxShadow: on ? `0 4px 18px ${C.green}44, inset 0 1px 0 rgba(255,255,255,0.15)` : "none",
        }}
      >
        {on && <span style={{ position: "absolute", left: 0, top: "22%", bottom: "22%", width: 3, borderRadius: 2, background: "rgba(255,255,255,0.55)" }} />}
        <span style={{
          display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: on ? "rgba(255,255,255,0.18)" : hovered ? C.accentSoft : "transparent",
          transform: hovered && !on ? "translateY(-2px) scale(1.08)" : "none",
          boxShadow: hovered && !on ? `0 4px 10px ${C.green}26` : "none",
        }}>
          <Icon size={15} strokeWidth={on ? 2.5 : 2} style={{ transform: hovered && !on ? "scale(1.1)" : "none" }} />
        </span>
        {!collapsed && (
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: label.length > 22 ? 11 : 13 }}>{label}</span>
        )}
        {collapsed && <span className="phar-tooltip">{label}</span>}
      </button>
    );
  };

  const logoutRef = useRef<HTMLButtonElement>(null);
  const logoutHover = hoveredItem === "__logout__";

  const handleLogoutClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    spawnRipple(e, logoutRef as React.RefObject<HTMLElement>, "phar-ripple-red");
    setShowLogoutModal(true);
  };

  return (
    <>
      {showLogoutModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowLogoutModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: 16, width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
            <div style={{ background: C.green, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#ffffff" }}>Logout</span>
              <button onClick={() => setShowLogoutModal(false)} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6, width: 26, height: 26, cursor: "pointer", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>✕</button>
            </div>
            <div style={{ padding: "32px 24px 20px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LogOut size={28} color="#dc2626" strokeWidth={2} />
              </div>
              <p style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 8px" }}>Are you sure?</p>
              <p style={{ fontSize: 13, color: C.text3, margin: 0, lineHeight: 1.5 }}>You will be logged out of the system.</p>
            </div>
            <div style={{ padding: "8px 24px 24px", display: "flex", gap: 10 }}>
              <button onClick={() => setShowLogoutModal(false)} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "1.5px solid rgba(220,38,38,0.3)", background: "#ffffff", color: "#dc2626", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>CANCEL</button>
              <button onClick={handleLogout} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: C.green, color: "#ffffff", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5, boxShadow: "0 4px 14px rgba(22,163,74,0.35)" }}>LOGOUT</button>
            </div>
          </div>
        </div>
      )}

      <div ref={wrapperRef} style={{ position: "sticky", top: 0, height: "100vh", flexShrink: 0, zIndex: 100, width: collapsed ? 78 : 264, transition: "width 0.25s cubic-bezier(0.22,1,0.36,1)" }}>
        <aside className="phar-sidebar" style={{
          width: "100%", height: "100vh", background: C.bg, display: "flex", flexDirection: "column",
          borderRight: `1px solid ${C.border}`, flexShrink: 0, position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -80, right: -80, width: 220, height: 220, borderRadius: "50%", background: darkMode ? "radial-gradient(circle, rgba(26,122,26,0.14) 0%, transparent 70%)" : "radial-gradient(circle, rgba(34,197,94,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: 80, left: -60, width: 180, height: 180, borderRadius: "50%", background: darkMode ? "radial-gradient(circle, rgba(46,168,46,0.08) 0%, transparent 70%)" : "radial-gradient(circle, rgba(26,122,26,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />

          <div style={{ padding: "18px 14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, overflow: "hidden", position: "relative" }}>
            <div style={{
              width: 44, height: 44, borderRadius: 13, flexShrink: 0,
              background: `linear-gradient(135deg, ${C.green}, ${C.mint})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: darkMode ? "0 4px 16px rgba(26,122,26,0.55), inset 0 1px 0 rgba(255,255,255,0.15)" : "0 4px 16px rgba(26,122,26,0.3),  inset 0 1px 0 rgba(255,255,255,0.25)",
              overflow: "hidden", position: "relative",
            }}>
              <img src="/logo.jpg" alt="MHO Logo" style={{ width: 44, height: 44, borderRadius: 13, objectFit: "cover", position: "relative", zIndex: 1 }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              <Activity size={20} color="#ffffff" strokeWidth={2.5} style={{ position: "absolute", zIndex: 0 }} />
            </div>

            {!collapsed && (
              <div className="phar-slide-in" style={{ overflow: "hidden", minWidth: 0 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: darkMode ? "rgba(74,222,128,0.14)" : C.greenLight, border: `1px solid ${darkMode ? "rgba(74,222,128,0.25)" : "rgba(22,163,74,0.25)"}`, borderRadius: 20, padding: "2px 8px", marginBottom: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.green, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: darkMode ? C.mint : C.greenMid, textTransform: "uppercase" }}>Pharmacy Portal</span>
                </div>
                <div style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: 0.1, lineHeight: 1.3, color: darkMode ? C.mint : C.green }}>Rural Healthcare Unit</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, marginTop: 1 }}>Lopez, Quezon</div>
              </div>
            )}
          </div>

          <nav style={{ padding: "14px 10px 0", flex: 1, position: "relative", zIndex: 1 }}>
            {!collapsed && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: C.text3, marginBottom: 8, paddingLeft: 6 }}>Menu</div>}
            {MENU_ITEMS.filter(i => i.section === "Menu").map(({ label, icon }) => (
              <NavBtn key={label} label={label} icon={icon} forwardedRef={label === "Dashboard" ? dashRef : undefined} />
            ))}

            <div style={{ height: 1, margin: "10px 6px", background: `linear-gradient(90deg, transparent, ${C.border} 30%, ${C.border} 70%, transparent)` }} />

            <div>
              {!collapsed && <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: C.text3, marginBottom: 8, paddingLeft: 6 }}>General</div>}
              {MENU_ITEMS.filter(i => i.section === "General").map(({ label, icon }) => <NavBtn key={label} label={label} icon={icon} />)}

              <div style={{ height: 1, margin: "8px 6px", background: C.border }} />

              <button
                ref={logoutRef} className="phar-logout-btn" onClick={handleLogoutClick}
                onMouseEnter={() => setHoveredItem("__logout__")} onMouseLeave={() => setHoveredItem(null)}
                title={collapsed ? "Logout" : undefined}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: collapsed ? 0 : 10,
                  justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "9px" : "9px 14px",
                  borderRadius: 12, marginTop: 2, background: logoutHover ? "rgba(229,62,62,0.07)" : "transparent",
                  color: darkMode ? "#f08080" : "#dc2626", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
                  position: "relative", overflow: "hidden",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: logoutHover ? "rgba(229,62,62,0.1)" : "transparent", transform: logoutHover ? "translateX(3px)" : "none" }}>
                  <LogOut className="phar-logout-icon" size={15} strokeWidth={2} />
                </span>
                {!collapsed && <span>Logout</span>}
                {collapsed && <span className="phar-tooltip">Logout</span>}
              </button>
            </div>
          </nav>

          {!collapsed && (
            <div style={{ margin: "0 10px 16px", padding: "12px 12px 10px", background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: C.shadow, position: "relative", zIndex: 1 }}>
              <MiniCalendar darkMode={darkMode} />
            </div>
          )}
        </aside>

        <button
          className="phar-toggle-btn" onClick={onToggleCollapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            position: "absolute", top: togglePos, right: -14, transform: "translateY(-50%)",
            width: 28, height: 28, borderRadius: "50%", background: C.green, border: "2px solid #ffffff",
            boxShadow: "0 2px 10px rgba(22,163,74,0.45)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
            color: "#ffffff", fontSize: 13, fontWeight: 900, lineHeight: 1,
          }}
        >
          <span style={{ display: "inline-block", transition: "transform 0.25s cubic-bezier(0.22,1,0.36,1)", transform: collapsed ? "rotate(180deg)" : "rotate(0deg)", fontSize: 14, lineHeight: 1 }}>‹</span>
        </button>
      </div>
    </>
  );
}