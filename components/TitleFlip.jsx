"use client";

import { FlipText } from "@/components/block/flip-text";

export default function TitleFlip({ children }) {
	return (
		<>
			<span className="sr-only">{children}</span>
			<span aria-hidden="true">
				<FlipText loop={false} duration={1.6} delay={0.2}>
					{children}
				</FlipText>
			</span>
		</>
	);
}
