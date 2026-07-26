import { supabase } from '@/lib/supabase'

export async function logAction(params: {
  user_name:   string
  user_role:   string
  action:      string
  module:      string
  description?: string
  status?:     'success' | 'warning' | 'error'
}) {
  await supabase.from('audit_logs').insert({
    user_name:   params.user_name,
    user_role:   params.user_role,
    action:      params.action,
    module:      params.module,
    description: params.description || '',
    status:      params.status || 'success',
  })
}