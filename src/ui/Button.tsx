import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
}

/** Default, primary (indigo) and ghost buttons. Never submits a form unless asked to. */
export function Button({ variant = "default", type = "button", className, ...rest }: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    variant === "primary" ? "beacon-btn-primary" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}
