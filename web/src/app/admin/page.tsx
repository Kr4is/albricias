/** Ported from `admin.index` (`app/routes/admin.py:37-40`): always redirect to the dashboard. */

import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/editions");
}
