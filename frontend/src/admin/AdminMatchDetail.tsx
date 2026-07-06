import { useParams, Link } from 'react-router-dom';
export default function AdminMatchDetail() {
  const { fixtureId } = useParams<{ fixtureId: string }>();
  return (
    <div>
      <Link to="/admin/dashboard" className="text-sm text-teal hover:underline mb-4 inline-block">
        &larr; Back to Dashboard
      </Link>
      <h1 className="text-2xl font-bold">Match {fixtureId}</h1>
      <p className="text-gray-400 text-sm mt-2">Match detail page (coming in next task)</p>
    </div>
  );
}
