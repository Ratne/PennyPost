import ButtonThemeToggle from "@/components/ButtonThemeToggle";
import { logout } from "@/app/(app)/actions";
import ShellApp from "@/components/ShellApp";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { requireSession } from "@/lib/auth";
import { isSendingEnabled } from "@/lib/config";
import { cn } from "@/lib/utils";
import { all } from "@/server/db";
import { LogOut } from "lucide-react";

export default async function AppLayout({ children }) {
	await requireSession();
	const isOn = isSendingEnabled();
	const newsletters = await all("SELECT id, name, slug, archive_enabled FROM newsletters ORDER BY name");

	return (
		<ShellApp
			newsletters={newsletters.map(({ id, name, slug, archive_enabled }) => ({
				id,
				name,
				archiveHref: archive_enabled ? getArchiveUrls({ slug }).siteIndex : null,
			}))}
			headerActions={
				<>
					<ButtonThemeToggle />
					<form action={logout}>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button type="submit" variant="ghost" size="icon-sm" aria-label="Log out">
									<LogOut />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Log out</TooltipContent>
						</Tooltip>
					</form>
				</>
			}
			footer={
				<p className="flex items-center gap-2 text-xs text-muted-foreground" title={isOn ? "Turn it off in Settings" : "Turn it on in Settings"}>
					<span className={cn("size-1.5 rounded-full", isOn ? "bg-emerald-500" : "bg-muted-foreground/50")} />
					{isOn ? "Sending on" : "Sending off"}
				</p>
			}
		>
			{children}
		</ShellApp>
	);
}
