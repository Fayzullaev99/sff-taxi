import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useRide } from '../api/queries';
import { PageHeader } from '../ui/controls';
import { RideDetail } from './RideDetail';

export default function RidePage() {
  const { rideId } = useParams();
  const ride = useRide(rideId ?? null);
  return (
    <div className="ride-page">
      <Link to="/rides" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Safarlar
      </Link>
      <PageHeader title={ride.data ? `Buyurtma #${ride.data.number}` : 'Buyurtma'} />
      {rideId && (
        <div className="card">
          <RideDetail rideId={rideId} standalone />
        </div>
      )}
    </div>
  );
}
