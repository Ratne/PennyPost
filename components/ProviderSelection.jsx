"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";

const SelectionContext = createContext(null);

// Row selection for a server-rendered table: rows and the header render checkboxes that share this state.
export default function ProviderSelection({ ids, children }) {
	const [selected, setSelected] = useState(() => new Set());
	const value = useMemo(() => {
		const visible = ids.filter((id) => selected.has(id));
		return {
			ids,
			selected: visible,
			isSelected: (id) => selected.has(id),
			toggle: (id) =>
				setSelected((current) => {
					const next = new Set(current);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				}),
			setAll: (isOn) => setSelected(isOn ? new Set(ids) : new Set()),
			clear: () => setSelected(new Set()),
		};
	}, [ids, selected]);

	return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
	return useContext(SelectionContext);
}

export function CheckboxRow({ id, label }) {
	const selection = useSelection();
	return <Checkbox checked={selection.isSelected(id)} onCheckedChange={() => selection.toggle(id)} aria-label={label} />;
}

export function CheckboxAll() {
	const { ids, selected, setAll } = useSelection();
	const state = selected.length === 0 ? false : selected.length === ids.length ? true : "indeterminate";
	return <Checkbox checked={state} onCheckedChange={() => setAll(state !== true)} aria-label="Select all on this page" />;
}
