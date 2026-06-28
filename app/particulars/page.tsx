"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { ParticularForm } from "./ParticularForm";
import { OverrideManagement } from "./OverrideManagement";

export default function ParticularsPage() {
  const utils = trpc.useUtils();
  const { data: particulars, isLoading } = trpc.particular.list.useQuery();
  const del = trpc.particular.delete.useMutation({
    onSuccess: () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Income &amp; Expenses</h1>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Add</Button>
        </div>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (
          <div className="space-y-2">
            {(particulars ?? []).map((p) => {
              const signed = p.type === "EXPENSE" ? -Math.abs(Number(p.amount)) : Math.abs(Number(p.amount));
              return (
                <div key={p.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <button className="text-left" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.frequency}</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className={signed < 0 ? "text-finance-expense" : "text-finance-income"}>
                        {formatCurrency(signed)}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(p.id); setFormOpen(true); }}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: p.id })}>Delete</Button>
                    </div>
                  </div>
                  {expanded === p.id && <div className="mt-2"><OverrideManagement particularId={p.id} /></div>}
                </div>
              );
            })}
          </div>
        )}
        {formOpen && (
          <ParticularForm isOpen={formOpen} particularId={editing} onClose={() => setFormOpen(false)} />
        )}
      </div>
    </Layout>
  );
}
