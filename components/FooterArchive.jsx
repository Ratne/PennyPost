import AvatarNewsletter from "@/components/AvatarNewsletter";
import { Footer } from "@/components/block/footer";
import LinksSocial from "@/components/LinksSocial";
import { currentYear } from "@/lib/format";
import { getSocialPlatform } from "@/lib/social";

export default function FooterArchive({ newsletter, indexHref }) {
	const social = (newsletter.socialLinks ?? [])
		.map((href) => ({ href, platform: getSocialPlatform(href) }))
		.filter(({ platform }) => platform)
		.map(({ href, platform }) => ({ label: platform.label, href, isExternal: true }));

	return (
		<Footer
			eyebrow={
				<a href={indexHref} className="inline-flex items-center gap-2">
					<AvatarNewsletter newsletter={newsletter} size={16} />
					{newsletter.name}
				</a>
			}
			title={newsletter.description || `Every issue of ${newsletter.name}, in one place.`}
			description={<LinksSocial links={newsletter.socialLinks} className="-ml-2.5" />}
			columns={[
				{
					title: "Read",
					links: [
						{ label: "All issues", href: indexHref },
						{ label: "Subscribe", href: `${indexHref.replace(/\/$/, "")}/#subscribe` },
					],
				},
				...(social.length > 0 ? [{ title: "Follow", links: social }] : []),
			]}
			wordmark={newsletter.name}
			bottom={`© ${currentYear()} ${newsletter.name}`}
		/>
	);
}
