import { FormEvent, useState } from 'react';

type LoginFormProps = {
  onSubmit: (username: string, password: string) => Promise<void>;
  isSubmitting: boolean;
  errorMessage: string | null;
};

export default function LoginForm({ onSubmit, isSubmitting, errorMessage }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(username, password);
  };

  return (
    <div className="card">
      <h1>gifselector</h1>
      <p className="muted">Sign in to manage your GIFs and WebPs.</p>
      <form className="stack" onSubmit={handleSubmit}>
        <label className="stack">
          <span>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label className="stack">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
