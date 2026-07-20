import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.js';

describe('OS App Smoke Test', () => {
  it('renders sidebar with ATLAS OS header', () => {
    render(<App />);
    expect(screen.getByText('ATLAS OS')).toBeInTheDocument();
  });

  it('renders all sections in the sidebar', () => {
    render(<App />);
    const sections = [
      'Mission Control',
      'Agents',
      'Pipelines',
      'Sites',
      'Leads & Outreach',
      'Conversations',
      'Kanban',
      'Memory',
      'Model Bench',
      'Approvals & Audit',
      'Settings',
    ];

    sections.forEach((sec) => {
      const elements = screen.getAllByText(sec);
      expect(elements.length).toBeGreaterThanOrEqual(1);
      expect(elements[0]).toBeInTheDocument();
    });
  });
});
