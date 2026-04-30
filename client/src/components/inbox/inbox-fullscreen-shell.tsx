interface InboxFullScreenShellProps {
  children: React.ReactNode;
}

export function InboxFullScreenShell({ children }: InboxFullScreenShellProps) {
  return (
    <div
      data-app-shell="inbox-fullscreen"
      className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden"
    >
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
