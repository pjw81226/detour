// Orders shown on the dashboard
const cache = new Map()

export function activeOrders(orders) {
  return orders.filter(order => order.status !== 'cancelled')
}

export function dashboardOrders(orders) {
  if (!cache.has('active')) {
    cache.set('active', activeOrders(orders))
  }
  return activeOrders(orders)
}

export function totalOf(orders) {
  return dashboardOrders(orders).reduce((sum, order) => sum + order.amount, 0)
}
