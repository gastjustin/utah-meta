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
import { Film, Library as LibIcon, Settings, LogOut, Users as UsersIcon, Search as SearchIcon, Settings as SettingsCog, Folder, Radio, Server, Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const admin = isAdmin();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItem = (to: string, label: string, icon: React.ReactNode) => (
    <Link
      to={to}
      onClick={() => setMobileOpen(false)}
      className={`inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded text-sm transition ${
        loc.pathname === to || (to === "/" && loc.pathname.startsWith("/media"))
          ? "bg-blue-600 text-white"
          : "text-gray-400 hover:text-white hover:bg-gray-800"
      }`}
    >
      {icon} <span className="hidden sm:inline">{label}</span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-950 border-b border-gray-800 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Film className="w-6 h-6 text-blue-500" />
          <span className="text-lg font-bold hidden sm:inline">UtahMeta</span>
        </div>
        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-2">
          {navItem("/", "Library", <LibIcon className="w-4 h-4" />)}
          {navItem("/search", "Search", <SearchIcon className="w-4 h-4" />)}
          {navItem("/collections", "Collections", <Folder className="w-4 h-4" />)}
          {navItem("/sessions", "Sessions", <Radio className="w-4 h-4" />)}
          {navItem("/edge-nodes", "Nodes", <Server className="w-4 h-4" />)}
          {navItem("/settings", "Settings", <SettingsCog className="w-4 h-4" />)}
          {admin && navItem("/users", "Users", <UsersIcon className="w-4 h-4" />)}
          {admin && navItem("/admin", "Admin", <Settings className="w-4 h-4" />)}
          <button
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition"
          >
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </nav>
        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-gray-400 hover:text-white p-2"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>
      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav className="md:hidden bg-gray-950 border-b border-gray-800 px-4 py-3 flex flex-col gap-1">
          {navItem("/", "Library", <LibIcon className="w-4 h-4" />)}
          {navItem("/search", "Search", <SearchIcon className="w-4 h-4" />)}
          {navItem("/collections", "Collections", <Folder className="w-4 h-4" />)}
          {navItem("/sessions", "Sessions", <Radio className="w-4 h-4" />)}
          {navItem("/edge-nodes", "Nodes", <Server className="w-4 h-4" />)}
          {navItem("/settings", "Settings", <SettingsCog className="w-4 h-4" />)}
          {admin && navItem("/users", "Users", <UsersIcon className="w-4 h-4" />)}
          {admin && navItem("/admin", "Admin", <Settings className="w-4 h-4" />)}
          <button
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </nav>
      )}
      <main className="h-[calc(100vh-56px)]">{children}</main>
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
