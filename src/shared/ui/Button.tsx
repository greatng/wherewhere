import type { JSX } from "preact";
import type { ComponentChildren } from "preact";

// Adapted from https://21st.dev/r/shugar/button-1 (component 3824, @shugar/button-1).
type Size = "tiny" | "small" | "medium" | "large";
type Appearance = "primary" | "secondary" | "tertiary" | "error" | "warning";
type Shape = "square" | "circle" | "rounded";

export type ButtonProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  size?: Size;
  appearance?: Appearance;
  variant?: "styled" | "unstyled";
  shape?: Shape;
  svgOnly?: boolean;
  children?: ComponentChildren;
  prefix?: ComponentChildren;
  suffix?: ComponentChildren;
  shadow?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
};

const sizeClasses: Record<Size, string> = {
  tiny: "button-size-tiny",
  small: "button-size-small",
  medium: "button-size-medium",
  large: "button-size-large",
};

export function Button({
  size = "medium",
  appearance = "primary",
  variant = "styled",
  shape = "square",
  svgOnly = false,
  children,
  prefix,
  suffix,
  shadow = false,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = "submit",
  onClick,
  class: className,
  ...props
}: ButtonProps) {
  const classes = [
    "app-button",
    `app-button--${appearance}`,
    `app-button--${shape}`,
    sizeClasses[size],
    variant === "unstyled" && "app-button--unstyled",
    svgOnly && "app-button--svg-only",
    shadow && "app-button--shadow",
    fullWidth && "app-button--full-width",
    loading && "app-button--loading",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      onClick={(event) => {
        if (!disabled && !loading) onClick?.(event);
      }}
      aria-busy={loading || props["aria-busy"]}
      class={classes}
    >
      {loading ? (
        <span class="app-button__spinner" aria-hidden="true" />
      ) : (
        prefix
      )}
      {children != null && children !== "" && (
        <span class="app-button__label">{children}</span>
      )}
      {!loading && suffix}
    </button>
  );
}
