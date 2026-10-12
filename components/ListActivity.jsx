import Link from "next/link";
import {
	BadgeCheck,
	Eye,
	History,
	MailCheck,
	MailX,
	Moon,
	MousePointerClick,
	PenLine,
	Send,
	ShieldAlert,
	Tag,
	Upload,
	UserCheck,
	UserPlus,
	UserX,
} from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import StateEmpty from "@/components/StateEmpty";
import TimeLocal from "@/components/TimeLocal";
import { describeActivity } from "@/lib/activity-labels";
import { cn } from "@/lib/utils";

const ICONS = {
	email_sent: Send,
	email_delivered: MailCheck,
	email_bounced: MailX,
	email_complained: ShieldAlert,
	opened: Eye,
	clicked: MousePointerClick,
	subscribed: UserPlus,
	resubscribed: UserPlus,
	confirmed: UserCheck,
	unsubscribed: UserX,
	reactivated: UserCheck,
	dormant: Moon,
	kept: UserCheck,
	bounced: MailX,
	complained: ShieldAlert,
	imported: Upload,
	tag_added: Tag,
	tag_removed: Tag,
	profile_updated: PenLine,
	verified: BadgeCheck,
};

const TONES = {
	email_bounced: "text-red-600 dark:text-red-400",
	email_complained: "text-red-600 dark:text-red-400",
	bounced: "text-red-600 dark:text-red-400",
	complained: "text-red-600 dark:text-red-400",
	unsubscribed: "text-amber-600 dark:text-amber-400",
	dormant: "text-amber-600 dark:text-amber-400",
	clicked: "text-emerald-600 dark:text-emerald-400",
	opened: "text-emerald-600 dark:text-emerald-400",
};

const TIME_OPTIONS = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };

export default function ListActivity({ events, newsletterMap, showNewsletter }) {
	if (events.length === 0) return <StateEmpty icon={History} title="Nothing here yet" />;
	return (
		<ol className="flex flex-col">
			{events.map((event) => {
				const Icon = ICONS[event.type] ?? History;
				const { title, detail } = describeActivity(event);
				const newsletter = event.newsletterId ? newsletterMap[event.newsletterId] : null;
				const isAutomatic = event.type === "opened" && event.data?.automatic;
				return (
					<li key={event.id} className="flex gap-3 px-4 py-3">
						<span
							className={cn(
								"mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground",
								!isAutomatic && TONES[event.type]
							)}
						>
							<Icon className="size-3.5" aria-hidden />
						</span>
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<p className={cn("text-sm text-pretty", isAutomatic && "text-muted-foreground")}>
								{event.campaignId && event.subject ? (
									<Link href={`/campaigns/${event.campaignId}`} className="hover:underline">
										{title}
									</Link>
								) : (
									title
								)}
							</p>
							{detail && (
								<p className={cn("text-xs text-muted-foreground", event.type === "clicked" ? "truncate font-mono" : "text-pretty")}>
									{detail}
								</p>
							)}
							<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
								<TimeLocal value={event.occurredAt} options={TIME_OPTIONS} />
								{showNewsletter && newsletter && (
									<span className="flex items-center gap-1.5">
										<AvatarNewsletter newsletter={newsletter} size={14} />
										{newsletter.name}
									</span>
								)}
							</p>
						</div>
					</li>
				);
			})}
		</ol>
	);
}
