export function SignInWithGoogle({ next }: { next: string }) {
  return (
    <a className="inline-flex min-h-11 items-center rounded-lg bg-[var(--navy)] px-5 py-3 font-semibold text-white hover:bg-[var(--navy-dark)]" href={`/auth/google?next=${encodeURIComponent(next)}`}>
      Continue with Google
    </a>
  );
}
