import ButtonRemoveAdmin from "@/components/ButtonRemoveAdmin";
import DialogAddAdmin from "@/components/DialogAddAdmin";
import FormAccount from "@/components/FormAccount";
import HeaderPage from "@/components/HeaderPage";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAdmins } from "@/lib/admins";
import { requireSession } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";

export const metadata = { title: "Admins" };

export default async function AdminsPage() {
	const [session, admins] = await Promise.all([requireSession(), listAdmins()]);

	return (
		<>
			<HeaderPage title="Admins">
				<DialogAddAdmin />
			</HeaderPage>

			<div className="flex flex-col gap-8">
				<div className="overflow-hidden rounded-xl shadow-border animate-enter">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-4">Email</TableHead>
								<TableHead className="hidden sm:table-cell">Added</TableHead>
								<TableHead className="hidden sm:table-cell">Last login</TableHead>
								<TableHead className="w-24 pr-2" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{admins.map((admin) => (
								<TableRow key={admin.id}>
									<TableCell className="py-2.5 pl-4 font-medium">
										{admin.email}
										{admin.id === session.adminId && <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>}
									</TableCell>
									<TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(admin.createdAt)}</TableCell>
									<TableCell className="hidden text-muted-foreground sm:table-cell">
										{admin.lastLoginAt ? formatRelative(admin.lastLoginAt) : "Never"}
									</TableCell>
									<TableCell className="pr-2 text-right">
										{admin.id !== session.adminId && <ButtonRemoveAdmin id={admin.id} email={admin.email} />}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>

				<div style={{ "--stagger": 1 }} className="max-w-2xl animate-enter">
					<FormAccount email={session.email} />
				</div>
			</div>
		</>
	);
}
