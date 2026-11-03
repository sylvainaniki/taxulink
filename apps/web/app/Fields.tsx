"use client";
import { useId, cloneElement, type ReactElement } from "react";
function LabeledField({
  label,
  child,
}: {
  label: string;
  child: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(child, { id })}
    </div>
  );
}
export function field(label: string, child: ReactElement<{ id?: string }>) {
  return <LabeledField label={label} child={child} />;
}
