"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import Papa from "papaparse";
import { toast } from "sonner";
import { importContacts } from "@/app/(app)/contacts/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import FileInput from "@/components/block/file-input";
import PickerTags from "@/components/PickerTags";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { MAX_IMPORT_ROWS_PER_REQUEST, mapColumns, normalizeImportRow } from "@/lib/csv-import";
import { formatNumber } from "@/lib/format";

export default function DialogImportContacts({ newsletters, defaultNewsletterId, tags = [] }) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [newsletterId, setNewsletterId] = useState(defaultNewsletterId || newsletters[0]?.id || "");
	const [mode, setMode] = useState("file");
	const [parsed, setParsed] = useState(null);
	const [tagNames, setTagNames] = useState([]);
	const [progress, setProgress] = useState(null);
	const [isImporting, startImporting] = useTransition();

	const rows = useMemo(() => {
		if (!parsed) return [];
		const options = mode === "dormant" ? { status: "dormant" } : {};
		return parsed.rows.map((row) => normalizeImportRow(row, parsed.columns, options)).filter(Boolean);
	}, [parsed, mode]);
	const statusCounts = useMemo(
		() =>
			Object.entries(Object.groupBy(rows, ({ status }) => status)).map(([status, group]) => [
				status,
				group.length,
			]),
		[rows]
	);

	function reset() {
		setParsed(null);
		setProgress(null);
		setTagNames([]);
	}

	// Rejecting makes the file input show its error state instead of the file.
	function onFileChange(files) {
		const selected = files[0];
		return new Promise((resolve, reject) => {
			Papa.parse(selected, {
				header: true,
				skipEmptyLines: true,
				complete: ({ data, meta }) => {
					const columns = mapColumns(meta.fields ?? []);
					if (!columns.email) {
						toast.error("No email column found");
						setParsed(null);
						return reject(new Error("No email column"));
					}
					setParsed({ rows: data, columns });
					resolve();
				},
				error: (error) => {
					toast.error("Could not read this file");
					reject(error);
				},
			});
		});
	}

	function runImport() {
		startImporting(async () => {
			const totals = { created: 0, existing: 0, invalid: 0 };
			for (let start = 0; start < rows.length; start += MAX_IMPORT_ROWS_PER_REQUEST) {
				setProgress(start / rows.length);
				const result = await importContacts({
					newsletterId,
					rows: rows.slice(start, start + MAX_IMPORT_ROWS_PER_REQUEST),
					tags: tagNames,
				});
				if (result?.error) {
					toast.error(result.error);
					return setProgress(null);
				}
				totals.created += result.created;
				totals.existing += result.existing;
				totals.invalid += result.invalid;
			}
			setProgress(1);
			toast.success(
				`${formatNumber(totals.created)} added, ${formatNumber(totals.existing)} already there`
			);
			setIsOpen(false);
			reset();
			router.refresh();
		});
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (isImporting) return;
				setIsOpen(open);
				if (!open) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" disabled={newsletters.length === 0}>
					<Upload data-icon="inline-start" />
					Import
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Import contacts</DialogTitle>
					<DialogDescription>
						CSV with an email column, and optionally a tags column. Existing contacts keep their status.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<div className="grid grid-cols-2 gap-2">
						<Select value={newsletterId} onValueChange={setNewsletterId} disabled={isImporting}>
							<SelectTrigger className="h-9 w-full" aria-label="Newsletter">
								<SelectValue placeholder="Newsletter" />
							</SelectTrigger>
							<SelectContent>
								{newsletters.map((newsletter) => (
									<SelectItem key={newsletter.id} value={newsletter.id}>
										<span className="flex items-center gap-2">
											<AvatarNewsletter newsletter={newsletter} size={16} />
											{newsletter.name}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select value={mode} onValueChange={setMode} disabled={isImporting}>
							<SelectTrigger className="h-9 w-full" aria-label="Status">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="file">Status from file</SelectItem>
								<SelectItem value="dormant">Import as dormant</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<FileInput
						accept=".csv, text/csv"
						maxSizeInMB={50}
						onFileChange={onFileChange}
						onRemove={() => setParsed(null)}
						disabled={isImporting}
						className="h-[180px] w-full"
					/>
					{parsed && (
						<p className="text-xs text-muted-foreground tabular-nums">
							{formatNumber(rows.length)} valid of {formatNumber(parsed.rows.length)} rows
							{parsed.columns.tags && " · tags column found"}
							{(parsed.columns.firstName || parsed.columns.lastName || parsed.columns.fullName) && " · names found"}
							{parsed.columns.phone && " · phone numbers found"}
						</p>
					)}

					<div className="flex flex-col gap-1.5">
						<span className="text-xs text-muted-foreground">Tag every imported contact</span>
						<PickerTags tags={tags} value={tagNames} onChange={setTagNames} />
					</div>

					{statusCounts.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{statusCounts.map(([status, count]) => (
								<span
									key={status}
									className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-xs text-muted-foreground tabular-nums"
								>
									{status} <span className="text-foreground">{formatNumber(count)}</span>
								</span>
							))}
						</div>
					)}

					{progress !== null && (
						<div className="h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-foreground transition-[width] duration-300"
								style={{ width: `${Math.max(progress, 0.02) * 100}%` }}
							/>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						onClick={runImport}
						disabled={!newsletterId || rows.length === 0 || isImporting}
						className="min-w-24"
					>
						{isImporting ? (
							<Loader2 className="animate-spin" />
						) : (
							`Import ${rows.length ? formatNumber(rows.length) : ""}`.trim()
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
