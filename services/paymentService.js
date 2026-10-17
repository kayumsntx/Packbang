// ==========================================
// PACKBANG PAYMENT SYSTEM (ESCROW & PAYOUT SERVICE)
// ==========================================
// This service manages:
// 1. Customer Escrow Deposits: Customer pays order amount to Admin.
// 2. Escrow Holding: Funds held securely by Admin while Seller manufactures/delivers.
// 3. Admin Commission & Payout: Admin deducts platform commission and releases net funds to Seller.
//
// NOTE FOR FUTURE REAL PAYMENT GATEWAY INTEGRATION:
// Replace the mock implementation sections marked [GATEWAY_INTEGRATION_HOOK]
// with live calls to your bKash, SSLCommerz, Shurjopay, or Stripe APIs.
// ==========================================

const { v4: uuidv4 } = require('uuid');
const PaymentTransaction = require('../models/PaymentTransaction');

class PaymentService {
    /**
     * 1. Customer pays Admin (Held in Escrow)
     * When customer assigns a seller, customer must deposit the agreed total amount to Admin.
     */
    async processCustomerEscrow({
        orderId,
        orderTitle,
        customerId,
        customerName,
        customerPhone,
        amount,
        paymentMethod = 'bkash',
        accountNumber = ''
    }) {
        if (!orderId || !customerId || !amount || amount <= 0) {
            throw new Error('Invalid payment parameters: Order ID, Customer ID, and valid amount are required.');
        }

        const txId = 'PB-ESC-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);

        // ==========================================
        // [GATEWAY_INTEGRATION_HOOK] Real Payment API:
        // When you implement a real payment gateway (bKash / SSLCommerz / Stripe):
        // 1. Call gateway.initiatePayment({ amount, currency: 'BDT', callbackUrl, txId })
        // 2. Redirect customer to the gateway checkout URL
        // 3. In the gateway IPN / webhook callback, verify transaction status
        // ==========================================
        console.log(`💳 [Payment Gateway Simulation] Processing BDT ${amount} from Customer ${customerName} (${customerId}) via ${paymentMethod}...`);

        // Record the escrow transaction in database
        const transaction = new PaymentTransaction({
            transactionId: txId,
            orderId: orderId,
            orderType: 'custom_order',
            payerId: customerId,
            payerName: customerName || 'Customer',
            payeeId: 'ADMIN_ESCROW',
            payeeName: 'PackBang Platform Escrow',
            amount: parseFloat(amount),
            commissionPercent: 0,
            commissionAmount: 0,
            netAmount: parseFloat(amount),
            type: 'customer_escrow_deposit',
            paymentMethod: paymentMethod,
            status: 'completed',
            gatewayDetails: {
                gatewayName: `Mock_${paymentMethod.toUpperCase()}_Gateway`,
                accountNumber: accountNumber || '01700000000',
                bankName: paymentMethod === 'bank_transfer' ? 'City Bank Ltd' : '',
                reference: `ESCROW_HOLD_${orderId}`
            },
            notes: `Customer deposited BDT ${amount} into PackBang Escrow for custom order: ${orderTitle || orderId}`
        });

        await transaction.save();

        return {
            success: true,
            transactionId: txId,
            amount: parseFloat(amount),
            paymentMethod: paymentMethod,
            status: 'completed',
            escrowStatus: 'held_by_admin',
            message: `BDT ${amount} successfully received by PackBang Escrow via ${paymentMethod.toUpperCase()}. Funds are safely held while seller starts production.`
        };
    }

    /**
     * 2. Admin releases payout to Seller after customer confirms receipt
     * Calculates Admin commission and pays the remaining net amount to the seller.
     */
    async processSellerPayout({
        orderId,
        orderTitle,
        sellerId,
        sellerName,
        grossAmount,
        commissionPercent = 10,
        payoutMethod = 'bkash',
        payoutAccountNumber = '',
        adminId = 'ADMIN'
    }) {
        if (!orderId || !sellerId || !grossAmount || grossAmount <= 0) {
            throw new Error('Invalid payout parameters: Order ID, Seller ID, and valid gross amount are required.');
        }

        const parsedGross = parseFloat(grossAmount);
        const parsedCommPct = Math.max(0, Math.min(100, parseFloat(commissionPercent) || 0));
        
        // Calculate commission & net payout
        const commissionAmount = Math.round(((parsedGross * parsedCommPct) / 100) * 100) / 100;
        const netPayoutAmount = Math.round((parsedGross - commissionAmount) * 100) / 100;

        const txId = 'PB-PAYOUT-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);

        // ==========================================
        // [GATEWAY_INTEGRATION_HOOK] Real Payout / Disbursement API:
        // When you implement automated payout (bKash B2C Disbursement / BEFTN bank transfer):
        // 1. Call disbursementApi.sendMoney({ recipient: payoutAccountNumber, amount: netPayoutAmount })
        // 2. Check response status and handle errors
        // ==========================================
        console.log(`🏦 [Payout Gateway Simulation] Releasing BDT ${netPayoutAmount} to Seller ${sellerName} (${sellerId}) via ${payoutMethod}. Admin Commission: ${parsedCommPct}% (BDT ${commissionAmount})`);

        // Record the payout transaction in database
        const transaction = new PaymentTransaction({
            transactionId: txId,
            orderId: orderId,
            orderType: 'custom_order',
            payerId: adminId,
            payerName: 'PackBang Admin Escrow',
            payeeId: sellerId,
            payeeName: sellerName || 'Packaging Supplier',
            amount: parsedGross,
            commissionPercent: parsedCommPct,
            commissionAmount: commissionAmount,
            netAmount: netPayoutAmount,
            type: 'seller_payout',
            paymentMethod: payoutMethod,
            status: 'completed',
            gatewayDetails: {
                gatewayName: `Mock_Disbursement_${payoutMethod.toUpperCase()}`,
                accountNumber: payoutAccountNumber || '01900000000',
                bankName: payoutMethod === 'bank_transfer' ? 'Islami Bank Bangladesh' : '',
                reference: `PAYOUT_${orderId}`
            },
            notes: `Admin released payout of BDT ${netPayoutAmount} to seller ${sellerName} after deducting ${parsedCommPct}% commission (BDT ${commissionAmount}).`
        });

        await transaction.save();

        return {
            success: true,
            transactionId: txId,
            grossAmount: parsedGross,
            commissionPercent: parsedCommPct,
            commissionAmount: commissionAmount,
            sellerPayoutAmount: netPayoutAmount,
            payoutMethod: payoutMethod,
            payoutStatus: 'paid',
            message: `Payout of BDT ${netPayoutAmount} successfully released to seller ${sellerName}. Admin commission of BDT ${commissionAmount} (${parsedCommPct}%) retained.`
        };
    }

    /**
     * Get all transactions for an order
     */
    async getOrderTransactions(orderId) {
        return await PaymentTransaction.find({ orderId: orderId }).sort({ createdAt: -1 });
    }
}

module.exports = new PaymentService();
