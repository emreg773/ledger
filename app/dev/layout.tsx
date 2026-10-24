import { notFound } from "next/navigation";

// /dev is the mock-data card preview. It never ships to production.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
