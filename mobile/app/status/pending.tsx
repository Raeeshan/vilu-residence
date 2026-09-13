import React from 'react';
import { StatusScreen } from '../../src/components/StatusScreen';
import { useAuth } from '../../src/state/useAuth';

export default function PendingScreen() {
  const { signOut } = useAuth();
  return (
    <StatusScreen
      icon="⏳"
      title="Application pending approval"
      message="Thanks for applying for Vilu Agency access. Vilu Residence is reviewing your application — you'll be able to sign in normally once it's approved."
      onSignOut={signOut}
    />
  );
}
