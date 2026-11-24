import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  shape?: "default" | "pill" | "small";
}

export function Button({ variant = "secondary", shape = "default", className, type = "button", ...rest }: Props) {
  const cls = [s.btn, variant !== "secondary" ? s[variant] : "", shape !== "default" ? s[shape] : "", className ?? ""].join(" ");
  return <button type={type} className={cls} {...rest} />;
}

/** A skill (or conversion) button: brush character in a vermilion seal + the name. */
export function SealButton({
  char,
  label,
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { char: string; label: ReactNode; active?: boolean }) {
  return (
    <button type="button" className={`${s.btn} ${s.sealBtn} ${active ? s.active : ""} ${className ?? ""}`} aria-pressed={active} {...rest}>
      <span className={s.sealChar} lang="zh-CN" aria-hidden="true">
        {char}
      </span>
      <span>{label}</span>
    </button>
  );
}
