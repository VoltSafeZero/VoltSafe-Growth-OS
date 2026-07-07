import { Link } from "wouter";
import { ShieldCheck, Settings2, Users2, ArrowRight } from "lucide-react";
import { CmsBreadcrumb } from "@/components/shared/cms-breadcrumb";

const cards = [
  {
    href: "/admin/users",
    icon: ShieldCheck,
    iconBg: "bg-sky-500/10",
    iconColor: "text-sky-400",
    title: "Users & Roles",
    desc: "Manage user accounts, assign roles, set section-level permissions, and control access.",
    tags: ["User accounts", "Permissions", "Access control"],
    testId: "card-users-roles",
  },
  {
    href: "/admin/roles",
    icon: Settings2,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
    title: "Role Manager",
    desc: "Define custom roles and permission sets — create role templates for quick user provisioning.",
    tags: ["Custom roles", "Templates", "Permissions"],
    testId: "card-role-manager",
  },
  {
    href: "/admin/task-hub-access",
    icon: Users2,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    title: "Task Hub Access",
    desc: "Control which users can view and manage other users' task hubs — cross-team visibility settings.",
    tags: ["Cross-team", "Task visibility", "Delegation"],
    testId: "card-task-hub-access",
  },
];

export default function AdminUsersRolesPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto" data-testid="hub-admin-users-roles">
      <div>
        <CmsBreadcrumb />
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
          Users & Roles
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          User management, role definitions, and access control for the VoltSafe platform.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(card => (
          <Link key={card.href} href={card.href}>
            <div
              className="group rounded-xl border border-border/50 bg-card hover:bg-primary/5 hover:border-primary/40 transition-all cursor-pointer p-5 flex flex-col gap-3 h-full"
              data-testid={card.testId}
            >
              <div className="flex items-center justify-between">
                <div className={`p-2 rounded-lg ${card.iconBg}`}>
                  <card.icon className={`w-5 h-5 ${card.iconColor}`} />
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">{card.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{card.desc}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-auto">
                {card.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/30">{tag}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
