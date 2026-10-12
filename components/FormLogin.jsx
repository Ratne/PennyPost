"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { login, restartLogin, verifyCode } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function authenticate(state, formData) {
	const step = formData.get("step");
	if (step === "restart") {
		await restartLogin();
		return null;
	}
	if (step !== "code") return login(state, formData);
	const result = await verifyCode(state, formData);
	return result?.step === "code" ? { ...result, email: state?.email } : result;
}

// A reload keeps the code step: the server knows from its cookie that a code is waiting (pendingEmail).
export default function FormLogin({ next, pendingEmail }) {
	const [state, action, isPending] = useActionState(authenticate, pendingEmail ? { step: "code", email: pendingEmail } : null);

	if (state?.step === "code") {
		return (
			<form action={action} className="flex flex-col gap-3">
				<input type="hidden" name="next" value={next || "/"} />
				<p className="text-center text-sm text-pretty text-muted-foreground">
					We sent a 6-digit code to <span className="font-medium text-foreground">{state.email}</span>. It works once, for 10
					minutes.
				</p>
				<Input
					name="code"
					inputMode="numeric"
					autoComplete="one-time-code"
					maxLength={7}
					placeholder="123456"
					aria-label="Login code"
					required
					autoFocus
					className="h-10 text-center font-mono text-lg tracking-[0.3em]"
				/>
				{state.error && <p className="text-sm text-destructive">{state.error}</p>}
				<Button type="submit" name="step" value="code" size="lg" disabled={isPending} className="mt-1">
					{isPending ? <Loader2 className="animate-spin" /> : "Log in"}
					{!isPending && <ArrowRight data-icon="inline-end" />}
				</Button>
				<Button type="submit" name="step" value="restart" formNoValidate variant="ghost" size="sm" disabled={isPending}>
					Start over
				</Button>
			</form>
		);
	}

	return (
		<form action={action} className="flex flex-col gap-3">
			<input type="hidden" name="next" value={next || "/"} />
			<Input name="email" type="email" placeholder="Email" autoComplete="email" required autoFocus className="h-10" />
			<Input
				name="password"
				type="password"
				placeholder="Password"
				autoComplete="current-password"
				required
				className="h-10"
			/>
			{state?.error && <p className="text-sm text-destructive">{state.error}</p>}
			<Button type="submit" name="step" value="password" size="lg" disabled={isPending} className="mt-1">
				{isPending ? <Loader2 className="animate-spin" /> : "Continue"}
				{!isPending && <ArrowRight data-icon="inline-end" />}
			</Button>
		</form>
	);
}
