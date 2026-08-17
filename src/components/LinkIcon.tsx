import {
  Link as LinkIco,
  MessageCircle,
  Music,
  Video,
  ThumbsUp,
  MapPin,
  Phone,
  Mail,
  Globe,
  Smartphone,
  UtensilsCrossed,
  Wine,
  Coffee,
  Calendar,
  Ticket,
  PartyPopper,
  Gift,
  Star,
  Crown,
  Users,
  Camera,
  Image as ImageIco,
  ShoppingBag,
  CreditCard,
  Briefcase,
  FileText,
  HelpCircle,
  Clock,
  Navigation,
} from "lucide-react";
// Instagram punya ikon brand sendiri di project (lucide tak menyertakan
// logo brand). Facebook/YouTube tak ada padanannya → pakai ikon generik.
import { InstagramIcon } from "@/components/ui/brand-icons";

/**
 * Peta nama ikon (tersimpan di DB) → komponen lucide.
 *
 * Dipisah dari lib/link-icons.ts karena file itu dipakai server (validasi)
 * dan tak boleh mengimpor komponen React.
 *
 * lucide tak punya ikon WhatsApp/brand tertentu → dipakai padanan terdekat
 * (MessageCircle). Lebih baik daripada menambah paket ikon baru hanya untuk
 * satu logo.
 */
const MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  link: LinkIco,
  instagram: InstagramIcon,
  whatsapp: MessageCircle,
  facebook: ThumbsUp,
  youtube: Video,
  music: Music,
  "map-pin": MapPin,
  phone: Phone,
  mail: Mail,
  globe: Globe,
  smartphone: Smartphone,
  utensils: UtensilsCrossed,
  wine: Wine,
  coffee: Coffee,
  calendar: Calendar,
  ticket: Ticket,
  "party-popper": PartyPopper,
  gift: Gift,
  star: Star,
  crown: Crown,
  users: Users,
  camera: Camera,
  image: ImageIco,
  "shopping-bag": ShoppingBag,
  "credit-card": CreditCard,
  briefcase: Briefcase,
  "file-text": FileText,
  "help-circle": HelpCircle,
  clock: Clock,
  navigation: Navigation,
};

export function LinkIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  // Nama tak dikenal (mis. ikon dihapus dari daftar) → jatuh balik ke "link"
  // supaya baris tautan tetap tampil, bukan crash.
  const Ico = MAP[name] ?? LinkIco;
  return <Ico className={className} />;
}
