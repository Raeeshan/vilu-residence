import React from 'react';
import { StatusScreen } from '../../src/components/StatusScreen';
import { useAuth } from '../../src/state/useAuth';
import { getVariantIdentity } from '../../src/config/variant';

export default function UnauthorizedScreen() {
  const { signOut } = useAuth();
  const identity = getVariantIdentity();
  return (
    <StatusScreen
      icon="🔒"
      title="Access refused"
      message={`This account isn't set up for ${identity.displayName}. If you think this is a mistake, contact Vilu Residence.`}
      onSignOut={signOut}
    />
  );
}
