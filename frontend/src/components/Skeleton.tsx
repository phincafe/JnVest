type Props = {
  className?: string;
};

export function Skeleton({ className = "" }: Props) {
  return (
    <div
      className={`animate-pulse rounded bg-(--color-panel-2) ${className}`}
      aria-hidden="true"
    />
  );
}
