// Regression test for the Task Hub Assignee / Shared dropdown scroll bug.
//
// Bug: inside the Task Detail drawer (a Radix Sheet/Dialog), Popover content
// portals to <body> by default. The Sheet's scroll-lock only allows wheel /
// touch scrolling for descendants of its own content node (or explicit
// "shards"), so wheel events over the Assignee and Shared popovers were
// silently swallowed — the list rendered but never scrolled.
//
// Fix: PopoverContent now accepts an optional `container` prop forwarded to
// Radix's Portal, and the Task Detail drawer provides a container ref (via
// DrawerPopoverContainerContext) that lives inside its own Sheet content, so
// popovers portal into the dialog's scroll-lock boundary instead of <body>.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`  \u2713 ${label}`); }
  else { fail++; console.log(`  \u2717 ${label}`); }
}

const popoverSrc = fs.readFileSync(path.join(__dirname, "../client/src/components/ui/popover.tsx"), "utf8");
const drawerSrc = fs.readFileSync(path.join(__dirname, "../client/src/components/tasks/task-detail-drawer.tsx"), "utf8");

console.log("=== Part A: PopoverContent supports a custom portal container ===");
check(
  "PopoverContent accepts a `container` prop",
  /container\?:\s*HTMLElement \| null/.test(popoverSrc)
);
check(
  "PopoverContent forwards container to PopoverPrimitive.Portal",
  /<PopoverPrimitive\.Portal container=\{container[^}]*\}>/.test(popoverSrc)
);

console.log("=== Part B: Task Detail drawer wires a shard-safe portal container ===");
check(
  "drawer defines a popover container context",
  /DrawerPopoverContainerContext = createContext<HTMLElement \| null>\(null\)/.test(drawerSrc)
);
check(
  "drawer's Sheet content div captures itself via ref as the popover container",
  /className="relative min-h-full" ref=\{setPopoverContainer\}/.test(drawerSrc)
);
check(
  "drawer wraps its content in the popover container Provider",
  /<DrawerPopoverContainerContext\.Provider value=\{popoverContainer\}>/.test(drawerSrc)
);
check(
  "ActionPopover reads the container from context",
  /const popoverContainer = useContext\(DrawerPopoverContainerContext\)/.test(drawerSrc)
);
check(
  "ActionPopover passes the container down to PopoverContent",
  /<PopoverContent align="start" className="w-72 p-3" container=\{popoverContainer\}>/.test(drawerSrc)
);

console.log("=== Part C: Assignee dropdown is scrollable with a bounded height ===");
const assigneeMatch = drawerSrc.match(/function AssigneeButton[\s\S]{0,1500}/);
check("AssigneeButton function found", !!assigneeMatch);
const assigneeBody = assigneeMatch ? assigneeMatch[0] : "";
check(
  "Assignee list has a bounded max-height",
  /max-h-\[280px\]/.test(assigneeBody)
);
check(
  "Assignee list is vertically scrollable",
  /overflow-y-auto/.test(assigneeBody)
);
check(
  "Assignee list contains scroll to prevent scroll-chaining to the drawer",
  /overscroll-contain/.test(assigneeBody)
);
check(
  "Assignee list has a stable test id for browser-level regression checks",
  /data-testid="list-assignee-options"/.test(assigneeBody)
);

console.log("=== Part D: Shared / participants dropdown is scrollable with a bounded height ===");
const participantsMatch = drawerSrc.match(/function ParticipantsButton[\s\S]{0,2400}/);
check("ParticipantsButton function found", !!participantsMatch);
const participantsBody = participantsMatch ? participantsMatch[0] : "";
check(
  "Add-participant list has a bounded max-height",
  /max-h-\[280px\]/.test(participantsBody)
);
check(
  "Add-participant list is vertically scrollable",
  /overflow-y-auto/.test(participantsBody)
);
check(
  "Add-participant list contains scroll to prevent scroll-chaining to the drawer",
  /overscroll-contain/.test(participantsBody)
);
check(
  "Add-participant list has a stable test id for browser-level regression checks",
  /data-testid="list-participant-options"/.test(participantsBody)
);

console.log("=== Part E: Existing assign/unassign/share/unshare wiring is untouched ===");
check("Unassign still PATCHes ownerUserId: null", /ownerUserId: null \}\); onChanged\(\); close\(\); \}\}/.test(assigneeBody));
check("Assign still PATCHes ownerUserId: u.id", /ownerUserId: u\.id \}\);\s*onChanged\(\);\s*close\(\);\s*\}\}/.test(assigneeBody));
check("Add participant still POSTs to /watchers/:id", /POST", `\/api\/tasks\/\$\{task\.id\}\/watchers\/\$\{u\.id\}`/.test(participantsBody));
check("Remove participant still DELETEs /watchers/:id", /DELETE", `\/api\/tasks\/\$\{task\.id\}\/watchers\/\$\{w\.id\}`/.test(drawerSrc));

console.log("─".repeat(60));
console.log(`Results: ${pass + fail} checks — ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`${fail} check(s) FAILED`);
  process.exit(1);
} else {
  console.log("All checks passed.");
}
