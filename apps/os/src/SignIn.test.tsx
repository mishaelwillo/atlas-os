import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SignIn } from './SignIn.js';

describe('operator sign-in view', () => {
  it('submits trimmed credentials', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SignIn onSubmit={onSubmit} status="signed_out" error={null} />);

    await userEvent.type(screen.getByLabelText('Email'), '  operator@example.com  ');
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(onSubmit).toHaveBeenCalledWith('operator@example.com', 'hunter2');
  });

  /** The password must not linger in component state after submit. */
  it('clears the password field once submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SignIn onSubmit={onSubmit} status="signed_out" error={null} />);

    await userEvent.type(screen.getByLabelText('Email'), 'operator@example.com');
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    await userEvent.type(password, 'hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(password.value).toBe('');
  });

  it('surfaces an error to assistive technology', () => {
    render(<SignIn onSubmit={vi.fn()} status="signed_out" error="Invalid login credentials" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid login credentials');
  });

  it('disables submission while authenticating', () => {
    render(<SignIn onSubmit={vi.fn()} status="authenticating" error={null} />);
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  });

  it('does not offer a form when identity is unconfigured', () => {
    render(<SignIn onSubmit={vi.fn()} status="unavailable" error={null} />);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByText(/no Supabase identity configured/i)).toBeInTheDocument();
  });

  it('reports a non-operator account as a policy outcome', () => {
    render(
      <SignIn
        onSubmit={vi.fn()}
        status="not_operator"
        error="Signed in as other@example.com, which is not the pinned operator."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('not the pinned operator');
  });
});
