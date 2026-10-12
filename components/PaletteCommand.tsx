"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ExternalLink, LogOut, Newspaper, Search, SunMoon } from "lucide-react";
import { logout } from "@/app/(app)/actions";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import type { DashboardShellNavItem } from "@/components/block/dashboard-shell";

type NewsletterLink = { id: string; name: string; archiveHref: string | null };

export default function PaletteCommand({ items, newsletters }: { items: DashboardShellNavItem[]; newsletters: NewsletterLink[] }) {
	const [isOpen, setIsOpen] = useState(false);
	const router = useRouter();
	const { resolvedTheme, setTheme } = useTheme();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setIsOpen((open) => !open);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	const run = (action: () => void) => {
		setIsOpen(false);
		action();
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				className="hidden h-[30px] items-center gap-2 rounded-md pr-1.5 pl-2.5 text-xs text-muted-foreground shadow-border transition-colors duration-150 hover:text-foreground sm:inline-flex"
			>
				<Search className="size-3.5" />
				Search
				<Kbd>⌘K</Kbd>
			</button>
			<button
				type="button"
				aria-label="Search"
				onClick={() => setIsOpen(true)}
				className="grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground sm:hidden"
			>
				<Search className="size-4" />
			</button>
			<CommandDialog open={isOpen} onOpenChange={setIsOpen} title="Search" description="Jump to a page or run a command">
				<CommandInput placeholder="Search pages, newsletters, commands…" />
				<CommandList>
					<CommandEmpty>Nothing found.</CommandEmpty>
					<CommandGroup heading="Pages">
						{items.map(({ id, label, icon: Icon, href }) => (
							<CommandItem key={id} value={`page ${label}`} onSelect={() => run(() => router.push(href!))}>
								{Icon && <Icon />}
								{label}
							</CommandItem>
						))}
					</CommandGroup>
					{newsletters.length > 0 && (
						<CommandGroup heading="Newsletters">
							{newsletters.flatMap(({ id, name, archiveHref }) => [
								<CommandItem key={id} value={`newsletter ${name} ${id}`} onSelect={() => run(() => router.push(`/newsletters/${id}`))}>
									<Newspaper />
									{name}
									<CommandShortcut>Settings</CommandShortcut>
								</CommandItem>,
								...(archiveHref
									? [
											<CommandItem key={`${id}-archive`} value={`archive ${name} ${id}`} onSelect={() => run(() => window.open(archiveHref, "_blank", "noopener"))}>
												<ExternalLink />
												{name}
												<CommandShortcut>Public archive</CommandShortcut>
											</CommandItem>,
										]
									: []),
							])}
						</CommandGroup>
					)}
					<CommandSeparator />
					<CommandGroup heading="Commands">
						<CommandItem value="toggle theme dark light" onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
							<SunMoon />
							Toggle theme
						</CommandItem>
						<CommandItem value="log out sign out" onSelect={() => run(() => void logout())}>
							<LogOut />
							Log out
						</CommandItem>
					</CommandGroup>
				</CommandList>
			</CommandDialog>
		</>
	);
}
