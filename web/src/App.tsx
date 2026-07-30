import { Navigate, Route, Routes } from "react-router-dom";
import { getToken, clearToken, isAdmin } from "./api";
import Login from "./pages/Login";
import Library from "./pages/Library";
import MediaDetail from "./pages/MediaDetail";
import Admin from "./pages/Admin";
import Users from "./pages/Users";
import { Film, Library as LibIcon, Settings, LogOut, Users as UsersIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const admin = isAdmin();
  const navItem = (to: string, label: string, icon: React.ReactNode) => (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded text-sm transition ${
        loc.pathname === to || (to === "/" && loc.pathname.startsWith("/media"))
          ? "bg-blue-600 text-white"
          : "text-gray-400 hover:text-white hover:bg-gray-800"
      }`}
    >
      {icon} {label}
    </Link>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Film className="w-6 h-6 text-blue-500" />
          <span className="text-lg font-bold">UtahMeta</span>
        </div>
        <nav className="flex items-center gap-2">
          {navItem("/", "Library", <LibIcon className="w-4 h-4" />)}
          {admin && navItem("/users", "Users", <UsersIcon className="w-4 h-4" />)}
          {admin && navItem("/admin", "Admin", <Settings className="w-4 h-4" />)}
          <button
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </nav>
      </header>
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
