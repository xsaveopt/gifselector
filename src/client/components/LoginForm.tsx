import { type FormEvent, useState } from "react";
import { LogoIcon } from "./Icons";

type LoginFormProps = {
  onSubmit: (username: string, password: string) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string | null;
};

export default function LoginForm({ onSubmit, isSubmitting, errorMessage }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(username, password);
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <span className="brand-mark">
            <LogoIcon width={22} height={22} />
          </span>
          <div>
            <h1>gifselector</h1>
            <p className="dim">Sign in to manage your collection.</p>
          </div>
        </div>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
