import React from 'react';
import { StatusScreen } from '../../src/components/StatusScreen';
import { useAuth } from '../../src/state/useAuth';

export default function SuspendedScreen() {
  const { signOut } = useAuth();
  return (
    <StatusScreen
      icon="⛔"
      title="Agency access suspended"
      message="Your Vilu Agency access has been suspended. Contact Vilu Residence for details."
      onSignOut={signOut}
    />
  );
}
