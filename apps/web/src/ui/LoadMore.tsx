import { ChevronDown } from 'lucide-react';
import { Button } from './controls';

/** The foot of a cursor-paged list: how many are shown and a button for the next page. */
export function LoadMore({
  shown,
  hasMore,
  loading,
  onMore,
}: {
  shown: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  return (
    <div className="table-foot">
      <span className="muted small">{shown} ta ko‘rsatildi</span>
      {hasMore && (
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronDown size={15} />}
          loading={loading}
          onClick={onMore}
        >
          Ko‘proq yuklash
        </Button>
      )}
    </div>
  );
}
