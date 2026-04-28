import { createFileRoute } from '@tanstack/react-router';
import { UsersPage } from '@/components/users';

export const Route = createFileRoute('/_app/users')({
  component: UsersPage,
});
