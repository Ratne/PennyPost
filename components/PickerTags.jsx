"use client";

import { useState } from "react";
import { Check, Plus, Tags, X } from "lucide-react";
import BadgeTag from "@/components/BadgeTag";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_TAG_LENGTH, normalizeTagName } from "@/lib/tag-names";
import { cn } from "@/lib/utils";

// Picks tags by name. With `allowCreate`, a name that matches no tag can be added and is created on save.
export default function PickerTags({ tags, value, onChange, allowCreate = true, placeholder = "Add tags", className }) {
	const [isOpen, setIsOpen] = useState(false);
	const [search, setSearch] = useState("");
	const byName = new Map(tags.map((tag) => [tag.name, tag]));
	const draft = normalizeTagName(search);
	const canCreate = allowCreate && draft && !byName.has(draft) && !value.includes(draft);

	function toggle(name) {
		onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);
	}

	return (
		<div className={cn("flex flex-wrap items-center gap-1.5", className)}>
			{value.map((name) => (
				<BadgeTag key={name} tag={byName.get(name) ?? { name, color: "gray" }} className="h-6 pr-1">
					<button
						type="button"
						onClick={() => toggle(name)}
						aria-label={`Remove ${name}`}
						className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
					>
						<X className="size-3" />
					</button>
				</BadgeTag>
			))}
			<Popover
				open={isOpen}
				onOpenChange={(open) => {
					setIsOpen(open);
					if (!open) setSearch("");
				}}
			>
				<PopoverTrigger asChild>
					<Button type="button" variant="outline" size="sm" className="h-6 gap-1 rounded-full px-2 text-xs">
						<Tags className="size-3" />
						{placeholder}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-64 p-0">
					<Command>
						<CommandInput
							placeholder={allowCreate ? "Search or create…" : "Search tags…"}
							value={search}
							onValueChange={(next) => setSearch(next.slice(0, MAX_TAG_LENGTH))}
						/>
						<CommandList>
							<CommandEmpty>{allowCreate ? "Type a name to create a tag." : "No tags."}</CommandEmpty>
							{tags.length > 0 && (
								<CommandGroup>
									{tags.map((tag) => {
										const isSelected = value.includes(tag.name);
										return (
											<CommandItem key={tag.id ?? tag.name} value={tag.name} onSelect={() => toggle(tag.name)}>
												<BadgeTag tag={tag} />
												{typeof tag.contacts === "number" && (
													<span className="text-xs text-muted-foreground tabular-nums">{tag.contacts}</span>
												)}
												<Check className={cn("ml-auto", isSelected ? "opacity-100" : "opacity-0")} />
											</CommandItem>
										);
									})}
								</CommandGroup>
							)}
							{canCreate && (
								<CommandGroup>
									<CommandItem
										value={`create ${draft}`}
										onSelect={() => {
											toggle(draft);
											setSearch("");
										}}
									>
										<Plus />
										Create “{draft}”
									</CommandItem>
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
