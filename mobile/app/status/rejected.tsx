import React from 'react';
import { StatusScreen } from '../../src/components/StatusScreen';
import { useAuth } from '../../src/state/useAuth';

export default function RejectedScreen() {
  const { signOut } = useAuth();
  return (
    <StatusScreen
      icon="✕"
      title="Application not approved"
      message="Your Vilu Agency application was not approved. Contact Vilu Residence if you have questions."
      onSignOut={signOut}
    />
  );
}
