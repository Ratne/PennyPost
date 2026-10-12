"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { removeAdmin } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

export default function ButtonRemoveAdmin({ id, email }) {
	const [isPending, startTransition] = useTransition();

	function remove() {
		if (!window.confirm(`Remove ${email}? They're signed out right away.`)) return;
		startTransition(async () => {
			const result = await removeAdmin(id);
			if (result?.error) toast.error(result.error);
			else toast.success("Admin removed");
		});
	}

	return (
		<Button variant="ghost" size="sm" onClick={remove} disabled={isPending} className="text-muted-foreground hover:text-destructive">
			{isPending ? <Loader2 className="animate-spin" /> : "Remove"}
		</Button>
	);
}
