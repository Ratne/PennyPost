"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Globe, KeyRound, LayoutGrid, Newspaper, Send, Settings, ShieldCheck, SlidersHorizontal, Tags, Users, Workflow } from "lucide-react";
import { DashboardShell, type DashboardShellNavSection } from "@/components/block/dashboard-shell";
import LogoApp from "@/components/LogoApp";
import PaletteCommand from "@/components/PaletteCommand";
import { APP_NAME } from "@/lib/config";

const NAVIGATION: DashboardShellNavSection[] = [
	{
		id: "audience",
		title: "Newsletter",
		items: [
			{ id: "/", label: "Overview", icon: LayoutGrid, href: "/" },
			{ id: "/campaigns", label: "Campaigns", icon: Send, href: "/campaigns" },
			{ id: "/contacts", label: "Contacts", icon: Users, href: "/contacts" },
			{ id: "/tags", label: "Tags", icon: Tags, href: "/tags" },
			{ id: "/segments", label: "Segments", icon: SlidersHorizontal, href: "/segments" },
			{ id: "/automations", label: "Automations", icon: Workflow, href: "/automations" },
		],
	},
	{
		id: "setup",
		title: "Setup",
		items: [
			{ id: "/newsletters", label: "Newsletters", icon: Newspaper, href: "/newsletters" },
			{ id: "/domains", label: "Domains", icon: Globe, href: "/domains" },
			{ id: "/api-keys", label: "API keys", icon: KeyRound, href: "/api-keys" },
			{ id: "/settings", label: "Settings", icon: Settings, href: "/settings" },
			{ id: "/settings/admins", label: "Admins", icon: ShieldCheck, href: "/settings/admins" },
		],
	},
];

const ITEMS = NAVIGATION.flatMap(({ items }) => items);

function findActive(rawPathname: string) {
	// A person's profile lives outside /contacts but belongs to it.
	const pathname = rawPathname.startsWith("/people/") ? "/contacts" : rawPathname;
	return ITEMS.filter(({ id }) => (id === "/" ? pathname === "/" : pathname === id || pathname.startsWith(`${id}/`))).at(-1) ?? ITEMS[0];
}

type ShellAppProps = {
	children: ReactNode;
	headerActions: ReactNode;
	footer: ReactNode;
	newsletters: { id: string; name: string; archiveHref: string | null }[];
};

export default function ShellApp({ children, headerActions, footer, newsletters }: ShellAppProps) {
	const active = findActive(usePathname());

	return (
		<div className="h-dvh">
			<DashboardShell
				brand={{ name: APP_NAME, description: "Amazon SES on Cloudflare", logo: <LogoApp className="size-7" /> }}
				navigation={NAVIGATION}
				activeItemId={active.id}
				title={active.label}
				headingLevel={2}
				headerActions={
					<>
						<PaletteCommand items={ITEMS} newsletters={newsletters} />
						{headerActions}
					</>
				}
				sidebarFooter={footer}
				defaultSidebarWidth={220}
			>
				<div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
			</DashboardShell>
		</div>
	);
}
