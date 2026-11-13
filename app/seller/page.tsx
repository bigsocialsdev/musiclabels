import { redirect } from 'next/navigation';

// The seller area grows with S4-M7: onboarding first, then tracks, sales and clearance requests.
export default function SellerHome() {
  redirect('/seller/onboarding');
}
