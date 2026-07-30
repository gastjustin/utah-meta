import { Navigate, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { getToken, clearToken, isAdmin } from "./api";
import Login from "./pages/Login";
import Library from "./pages/Library";
import MediaDetail from "./pages/MediaDetail";
import Admin from "./pages/Admin";
import Users from "./pages/Users";
import SeriesDetail from "./pages/SeriesDetail";
import Search from "./pages/Search";
import SettingsPage from "./pages/Settings";
import Collections from "./pages/Collections";
import Sessions from "./pages/Sessions";
import EdgeNodes from "./pages/EdgeNodes";
import { Film, Home, Settings, LogOut, Users as UsersIcon, Search as SearchIcon, Folder, Radio, Server, Sliders, Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const admin = isAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { to: "/", label: "Home", icon: <Home className="w-5 h-5" /> },
    { to: "/search", label: "Search", icon: <SearchIcon className="w-5 h-5" /> },
    { to: "/collections", label: "Collections", icon: <Folder className="w-5 h-5" /> },
    { to: "/sessions", label: "Sessions", icon: <Radio className="w-5 h-5" /> },
    { to: "/edge-nodes", label: "Nodes", icon: <Server className="w-5 h-5" /> },
    { to: "/settings", label: "Settings", icon: <Sliders className="w-5 h-5" /> },
  ];
  if (admin) {
    navItems.push({ to: "/users", label: "Users", icon: <UsersIcon className="w-5 h-5" /> });
    navItems.push({ to: "/admin", label: "Admin", icon: <Settings className="w-5 h-5" /> });
  }

  const isActive = (to: string) =>
    loc.pathname === to || (to === "/" && loc.pathname.startsWith("/media"));

  const sidebar = (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
            isActive(item.to)
              ? "bg-white/10 text-white"
              : "text-gray-500 hover:text-white hover:bg-white/5"
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-[#0f0f11] border-r border-white/5 fixed h-full z-40">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/5">
          <Film className="w-7 h-7 text-amber-500" />
          <span className="text-lg font-bold tracking-tight">UtahMeta</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          {sidebar}
        </div>
        <div className="px-3 py-4 border-t border-white/5">
          <button
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-white hover:bg-white/5 transition w-full"
          >
            <LogOut className="w-5 h-5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-[#0f0f11] border-b border-white/5 px-4 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-2">
          <Film className="w-6 h-6 text-amber-500" />
          <span className="font-bold">UtahMeta</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-gray-400 hover:text-white p-1"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 top-12 bg-[#0f0f11] z-30 p-4 overflow-y-auto">
          {sidebar}
          <div className="mt-4 pt-4 border-t border-white/5">
            <button
              onClick={() => {
                clearToken();
                window.location.href = "/login";
              }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-white hover:bg-white/5 transition w-full"
            >
              <LogOut className="w-5 h-5" /> Sign out
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-56 mt-12 md:mt-0 h-full overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;
  if (!isAdmin()) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Library />
          </Protected>
        }
      />
      <Route
        path="/media/:id"
        element={
          <Protected>
            <MediaDetail />
          </Protected>
        }
      />
      <Route
        path="/series/:id"
        element={
          <Protected>
            <SeriesDetail />
          </Protected>
        }
      />
      <Route
        path="/search"
        element={
          <Protected>
            <Search />
          </Protected>
        }
      />
      <Route
        path="/collections"
        element={
          <Protected>
            <Collections />
          </Protected>
        }
      />
      <Route
        path="/sessions"
        element={
          <Protected>
            <Sessions />
          </Protected>
        }
      />
      <Route
        path="/edge-nodes"
        element={
          <AdminOnly>
            <EdgeNodes />
          </AdminOnly>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route
        path="/users"
        element={
          <AdminOnly>
            <Users />
          </AdminOnly>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminOnly>
            <Admin />
          </AdminOnly>
        }
      />
    </Routes>
  );
}
