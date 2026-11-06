import { type ButtonHTMLAttributes, forwardRef } from "react";
import { Link, type LinkProps } from "react-router-dom";
import styles from "./Button.module.css";

type Variant = "default" | "primary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

function classesFor(variant: Variant, className: string | undefined): string {
  return [
    styles.button,
    styles[variant],
    variant === "primary" ? "beacon-btn-primary" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Default, primary (indigo) and ghost buttons. Never submits a form unless asked to. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", type = "button", className, ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={classesFor(variant, className)} {...rest} />;
});

/** A router link that looks like a button, for actions that navigate. */
export function ButtonLink({
  variant = "default",
  className,
  ...rest
}: LinkProps & { variant?: Variant }) {
  return <Link className={classesFor(variant, className)} {...rest} />;
}
