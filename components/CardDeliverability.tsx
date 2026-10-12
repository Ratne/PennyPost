"use client";

import { StatusBars, type StatusDay } from "@/components/block/status-bars";

export default function CardDeliverability({ days }: { days: StatusDay[] }) {
	return (
		<div className="rounded-2xl bg-card p-5 shadow-border sm:p-6">
			<StatusBars
				days={days}
				label="Bounces and complaints"
				metricLabel="delivered"
				calmLabel="No bounces or complaints"
				words={{ up: "Healthy", degraded: "Watch", down: "At risk", none: "No sends" }}
				currentWords={{ up: "Healthy", degraded: "Rates near SES limits", down: "Above SES limits", none: "Nothing sent today" }}
			/>
		</div>
	);
}
