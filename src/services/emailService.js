/**
 * Email Service for Sai Lakshmi Home Foods
 * Handles transactional emails with branded HTML templates
 *
 * Required environment variables:
 * - SMTP_HOST (default: smtp.gmail.com)
 * - SMTP_PORT (default: 587)
 * - SMTP_USER (Gmail address)
 * - SMTP_PASS (Gmail App Password)
 * - SMTP_FROM_EMAIL (default: same as SMTP_USER)
 * - SMTP_FROM_NAME (default: Sai Lakshmi Home Foods)
 */

import nodemailer from 'nodemailer';

const BRAND_COLORS = {
  maroon: '#7B0D1E',
  yellow: '#FFD700',
  bodyText: '#5a0010',
  divider: 'rgba(123, 13, 30, 0.35)',
  summaryBorder: '#7B0D1E',
  summaryBackground: 'rgba(255, 255, 255, 0.2)'
};

const BUSINESS_INFO = {
  name: 'Sai Lakshmi Home Foods',
  logoUrl: 'https://res.cloudinary.com/ddrul5cxk/image/upload/sailakshmi.webp',
  website: process.env.PUBLIC_WEBSITE_URL || 'https://www.sailakshmihomefoods.com',
  contactUrl: process.env.PUBLIC_CONTACT_URL || 'https://www.sailakshmihomefoods.com',
  privacyUrl: process.env.PUBLIC_PRIVACY_URL || 'https://www.sailakshmihomefoods.com/privacy-policy',
  unsubscribeUrl: process.env.PUBLIC_UNSUBSCRIBE_URL || 'https://www.sailakshmihomefoods.com/unsubscribe',
  ordersUrl: process.env.PUBLIC_ORDERS_URL || 'https://www.sailakshmihomefoods.com/orders',
  address: '50-27-14, Gurudwara Up Road, Near Eenadu Junction, Opp. Electrical Substation, Akkayapalem, Balayya Sastri Layout, Seethammadara, Visakhapatnam, Andhra Pradesh 530013',
  email: 'sailakshmihomefoods@gmail.com',
  phone: '099665 39144'
};

const EMAIL_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const AUTOMATED_NOTE = 'This is an automated email. Please do not reply directly to this message.';

// Create transporter (lazy initialization)
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    console.log('Email Config Check:');
    console.log(`   Host: ${host}`);
    console.log(`   Port: ${port}`);
    console.log(`   User: ${user ? 'Set' : 'Missing'}`);
    console.log(`   Pass: ${pass ? 'Set' : 'Missing'}`);

    if (!user || !pass) {
      console.error('CRITICAL: Email service not configured. Set SMTP_USER and SMTP_PASS in environment variables.');
      return null;
    }

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 5000,
      socketTimeout: 5000,
      tls: { rejectUnauthorized: true }
    });

    transporter.verify((error) => {
      if (error) {
        console.error('SMTP transporter error:', error.message);
      } else {
        console.log('SMTP transporter verified and ready');
      }
    });
  }
  return transporter;
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatCurrency = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return '₹0';
  }
  return `₹${numericAmount.toLocaleString('en-IN')}`;
};

const formatDate = (value, { includeTime = false } = {}) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
};

const formatPaymentMode = (method) => {
  if (!method) {
    return '-';
  }
  const normalizedMethod = String(method).toLowerCase();
  if (normalizedMethod === 'razorpay') {
    return 'Online (Razorpay)';
  }
  if (normalizedMethod === 'cod') {
    return 'Cash on Delivery';
  }
  return String(method).toUpperCase();
};

const formatAddressHtml = (customer = {}) => {
  const lineOne = customer.address ? escapeHtml(customer.address) : '-';
  const regionParts = [customer.state, customer.country].filter(Boolean).map(escapeHtml);
  const region = regionParts.join(', ');
  const pincode = customer.pincode ? escapeHtml(customer.pincode) : '';
  const lineTwo = [region, pincode].filter(Boolean).join(' - ');

  return [lineOne, lineTwo].filter(Boolean).join('<br>');
};

const renderDivider = () => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;border-collapse:collapse;">
    <tr>
      <td style="border-top:1px dashed ${BRAND_COLORS.divider};font-size:0;line-height:0;">&nbsp;</td>
    </tr>
  </table>
`;

const renderSummaryBox = (innerHtml) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${BRAND_COLORS.summaryBorder};background-color:${BRAND_COLORS.summaryBackground}!important;">
    <tr>
      <td style="padding:16px;background-color:${BRAND_COLORS.summaryBackground}!important;">
        ${innerHtml}
      </td>
    </tr>
  </table>
`;

const renderKeyValueTable = (rows = []) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
    ${rows
      .filter((row) => row?.label)
      .map((row) => {
        const rawValue = row.value === undefined || row.value === null || row.value === '' ? '-' : row.value;
        const displayValue = row.isHtml ? String(rawValue) : escapeHtml(rawValue);
        return `
          <tr class="label-value-row">
            <td class="label-cell" style="padding:6px 0;width:42%;font-size:13px;line-height:18px;font-weight:bold;color:${BRAND_COLORS.bodyText};vertical-align:top;">
              ${escapeHtml(row.label)}
            </td>
            <td class="value-cell" style="padding:6px 0;font-size:13px;line-height:18px;color:${BRAND_COLORS.bodyText};">
              ${displayValue}
            </td>
          </tr>
        `;
      })
      .join('')}
  </table>
`;

const renderItemsTable = (items = [], totalLabel = 'Total Amount', totalAmount = 0) => {
  const itemRows = (Array.isArray(items) ? items : []).map((item, index) => {
    const quantity = Number(item?.quantity);
    const price = Number(item?.price);
    const total = Number(item?.total);
    const lineAmount = Number.isFinite(total) ? total : (Number.isFinite(price) ? price * (Number.isFinite(quantity) ? quantity : 0) : 0);
    const productName = escapeHtml(item?.name || 'Item');
    const weight = item?.weight ? ` <span style="font-size:11px;color:${BRAND_COLORS.bodyText};">(${escapeHtml(item.weight)})</span>` : '';
    const imageUrl = item?.image ? escapeHtml(String(item.image)) : BUSINESS_INFO.logoUrl;
    const altText = escapeHtml(item?.name || 'Product');
    const rowBackground = index % 2 === 1 ? `background-color:rgba(255,255,255,0.15)!important;` : '';

    return `
      <tr style="${rowBackground}">
        <td style="padding:8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;color:${BRAND_COLORS.bodyText};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:0 8px 0 0;vertical-align:top;">
                <img src="${imageUrl}" alt="${altText}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:4px;border:1px solid ${BRAND_COLORS.summaryBorder};object-fit:cover;">
              </td>
              <td style="vertical-align:top;">
                <span style="display:block;color:${BRAND_COLORS.bodyText};font-size:12px;line-height:16px;">${productName}${weight}</span>
              </td>
            </tr>
          </table>
        </td>
        <td align="center" class="product-quantity" style="padding:8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;color:${BRAND_COLORS.bodyText};">
          ${Number.isFinite(quantity) ? quantity : '-'}
        </td>
        <td align="right" class="product-total" style="padding:8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;color:${BRAND_COLORS.bodyText};">
          ${formatCurrency(lineAmount)}
        </td>
      </tr>
    `;
  }).join('');

  const emptyStateRow = `
    <tr>
      <td colspan="3" style="padding:10px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;color:${BRAND_COLORS.bodyText};text-align:center;">
        No items available
      </td>
    </tr>
  `;

  return `
    <table role="presentation" class="items-table" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-collapse:collapse;">
      <tr>
        <td style="padding:8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;font-weight:bold;color:${BRAND_COLORS.bodyText};">Item</td>
        <td align="center" style="padding:8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;font-weight:bold;color:${BRAND_COLORS.bodyText};">Qty</td>
        <td align="right" style="padding:8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:12px;line-height:16px;font-weight:bold;color:${BRAND_COLORS.bodyText};">Price</td>
      </tr>
      ${itemRows || emptyStateRow}
      <tr>
        <td colspan="2" align="right" style="padding:10px 8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:13px;line-height:18px;font-weight:bold;color:${BRAND_COLORS.bodyText};">
          ${escapeHtml(totalLabel)}
        </td>
        <td align="right" style="padding:10px 8px;border:1px solid ${BRAND_COLORS.summaryBorder};font-size:13px;line-height:18px;font-weight:bold;color:${BRAND_COLORS.bodyText};">
          ${formatCurrency(totalAmount)}
        </td>
      </tr>
    </table>
  `;
};

const renderFooter = () => `
  <tr>
    <td bgcolor="${BRAND_COLORS.maroon}" style="background-color:${BRAND_COLORS.maroon}!important;padding:18px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td align="center" style="padding:0 0 10px 0;">
            <img src="${BUSINESS_INFO.logoUrl}" alt="${BUSINESS_INFO.name}" width="32" height="32" style="display:block;width:32px;height:32px;border-radius:50%;border:1px solid ${BRAND_COLORS.yellow};">
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 0 6px 0;font-family:${EMAIL_FONT_FAMILY};font-size:12px;line-height:18px;color:${BRAND_COLORS.yellow};">
            ${BUSINESS_INFO.address}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 0 6px 0;font-family:${EMAIL_FONT_FAMILY};font-size:12px;line-height:18px;color:${BRAND_COLORS.yellow};">
            ${BUSINESS_INFO.email} | Phone: ${BUSINESS_INFO.phone}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0;font-family:${EMAIL_FONT_FAMILY};font-size:12px;line-height:18px;color:${BRAND_COLORS.yellow};">
            &copy; 2026 ${BUSINESS_INFO.name}. All rights reserved.
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;

const renderEmailTemplate = ({
  subject,
  badgeText,
  badgeInverted = false,
  heading,
  introLines = [],
  summaryHtml,
  ctaLabel,
  ctaUrl
}) => {
  const badgeBackground = badgeInverted ? BRAND_COLORS.maroon : BRAND_COLORS.yellow;
  const badgeTextColor = badgeInverted ? BRAND_COLORS.yellow : BRAND_COLORS.maroon;

  return `
    <!doctype html>
    <html lang="en">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light">
      <title>${escapeHtml(subject)}</title>
      <style>
        @media only screen and (max-width: 480px) {
          body, table[role="presentation"] {
            width: 100% !important;
          }
          
          .container-outer > tr > td {
            padding: 12px 8px !important;
          }
          
          .container-main {
            max-width: 100% !important;
            width: 100% !important;
          }
          
          .header-section {
            padding: 16px 12px !important;
          }
          
          .content-section {
            padding: 16px 12px !important;
          }
          
          .label-value-row {
            display: block !important;
          }
          
          .label-cell {
            width: 100% !important;
            display: block !important;
            margin-bottom: 4px !important;
            font-weight: bold;
          }
          
          .value-cell {
            width: 100% !important;
            display: block !important;
            text-align: left !important;
          }
          
          .items-table {
            font-size: 12px !important;
          }
          
          .items-table td {
            padding: 8px 4px !important;
          }
          
          .product-quantity,
          .product-total {
            font-size: 11px !important;
          }
          
          h1 {
            font-size: 20px !important;
          }
          
          .cta-button {
            max-width: 100% !important;
            width: auto !important;
          }
        }
      </style>
    </head>
    <body style="Margin:0;padding:0;background-color:${BRAND_COLORS.yellow}!important;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        ${escapeHtml(subject)}
      </div>

      <table role="presentation" class="container-outer" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND_COLORS.yellow}" style="background-color:${BRAND_COLORS.yellow}!important;">
        <tr>
          <td align="center" style="padding:24px 12px;background-color:${BRAND_COLORS.yellow}!important;">
            <table role="presentation" class="container-main" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND_COLORS.yellow}" style="width:100%;max-width:600px;border-collapse:collapse;background-color:${BRAND_COLORS.yellow}!important;">
              <tr>
                <td class="header-section" align="center" bgcolor="${BRAND_COLORS.maroon}" style="background-color:${BRAND_COLORS.maroon}!important;padding:20px 24px;">
                  <img src="${BUSINESS_INFO.logoUrl}" alt="${BUSINESS_INFO.name}" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:50%;border:2px solid ${BRAND_COLORS.yellow};">
                  <div style="font-family:${EMAIL_FONT_FAMILY};font-size:24px;line-height:30px;font-weight:bold;color:${BRAND_COLORS.yellow};padding-top:10px;">
                    ${BUSINESS_INFO.name}
                  </div>
                </td>
              </tr>

              <tr>
                <td class="content-section" bgcolor="${BRAND_COLORS.yellow}" style="padding:24px;font-family:${EMAIL_FONT_FAMILY};color:${BRAND_COLORS.bodyText};background-color:${BRAND_COLORS.yellow}!important;">
                  <span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${badgeBackground};color:${badgeTextColor};border:1px solid ${BRAND_COLORS.maroon};font-size:11px;line-height:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;">
                    ${escapeHtml(badgeText)}
                  </span>

                  <h1 style="Margin:14px 0 8px 0;font-size:24px;line-height:30px;color:${BRAND_COLORS.bodyText};">
                    ${escapeHtml(heading)}
                  </h1>

                  ${introLines
                    .map((line, index) => `
                      <p style="Margin:${index === introLines.length - 1 ? '0' : '0 0 12px 0'};font-size:14px;line-height:22px;color:${BRAND_COLORS.bodyText};">
                        ${escapeHtml(line)}
                      </p>
                    `)
                    .join('')}

                  ${renderDivider()}
                  ${summaryHtml}

                  <table role="presentation" class="cta-button" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                    <tr>
                      <td align="center" bgcolor="${BRAND_COLORS.maroon}" style="background-color:${BRAND_COLORS.maroon}!important;border-radius:4px;">
                        <a href="${ctaUrl || BUSINESS_INFO.ordersUrl}" target="_blank" style="display:inline-block;padding:12px 20px;font-family:${EMAIL_FONT_FAMILY};font-size:14px;line-height:14px;font-weight:bold;color:${BRAND_COLORS.yellow};text-decoration:none;">
                          ${escapeHtml(ctaLabel)}
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="Margin:18px 0 0 0;font-size:12px;line-height:18px;color:${BRAND_COLORS.bodyText};font-style:italic;">
                    ${AUTOMATED_NOTE}
                  </p>
                </td>
              </tr>

              ${renderFooter()}
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

/**
 * Send email helper with admin notification
 * PRODUCTION-SAFE: Includes detailed error logging and timeout handling
 */
const sendEmail = async (to, subject, html) => {
  const transport = getTransporter();

  if (!transport) {
    console.warn(`WARNING [MOCK MODE]: Email not configured. Would send to ${to}: ${subject}`);
    return { success: false, error: 'SMTP not configured', mock: true };
  }

  const startTime = Date.now();

  try {
    const fromName = process.env.SMTP_FROM_NAME || BUSINESS_INFO.name;
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

    if (!fromEmail) {
      throw new Error('SMTP_USER not configured - cannot send emails');
    }

    console.log(`Sending email to ${to} | Subject: ${subject}`);

    const customerEmail = await Promise.race([
      transport.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
        headers: {
          'X-Priority': '3',
          'X-Mailer': 'Sai Lakshmi Mailer'
        }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Email send timeout after 10s')), 10000)
      )
    ]);

    const duration = Date.now() - startTime;
    console.log(`Customer email sent: ${to} | MessageID: ${customerEmail.messageId} | Duration: ${duration}ms`);

    (async () => {
      try {
        const adminSubject = `[ADMIN COPY] ${subject}`;
        const adminEmail = process.env.ADMIN_EMAIL || 'yash.freelancer17@gmail.com';

        await Promise.race([
          transport.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: adminEmail,
            subject: adminSubject,
            html,
            headers: {
              'X-Priority': '3',
              'X-Mailer': 'Sai Lakshmi Mailer'
            }
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Admin email timeout')), 5000)
          )
        ]);

        console.log(`Admin copy sent to ${adminEmail}`);
      } catch (adminError) {
        console.error('Admin email failed (non-critical):', adminError.message);
      }
    })();

    return {
      success: true,
      messageId: customerEmail.messageId,
      duration,
      to
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error(`\nEMAIL SEND FAILED (${duration}ms)`);
    console.error(`   Recipient: ${to}`);
    console.error(`   Subject: ${subject}`);
    console.error(`   Error Type: ${error.name}`);
    console.error(`   Error Message: ${error.message}`);

    if (error.message.includes('Invalid login')) {
      console.error('   CAUSE: Wrong Gmail password or account blocked');
      console.error('   FIX: Verify SMTP_PASS is correct Gmail App Password');
    } else if (error.message.includes('timeout')) {
      console.error('   CAUSE: Network timeout to SMTP server');
      console.error('   FIX: Check if server can reach smtp.gmail.com:587');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('   CAUSE: Cannot connect to SMTP server');
      console.error('   FIX: Verify SMTP_HOST and SMTP_PORT are correct');
    }

    return {
      success: false,
      error: error.message,
      to,
      duration
    };
  }
};

// ============================================
// EMAIL TEMPLATES
// ============================================

/**
 * 1) ORDER PLACED
 * Subject: "Payment received for your order"
 */
export const sendPaymentConfirmationEmail = async (order) => {
  const subject = 'Payment received for your order';
  const customerName = order?.customer?.name || 'Customer';
  const customerEmail = order?.customer?.email;

  const summaryHtml = renderSummaryBox(`
    ${renderKeyValueTable([
      { label: 'Order Date', value: formatDate(order?.createdAt) },
      { label: 'Payment Mode', value: formatPaymentMode(order?.payment?.method) },
      { label: 'Delivery Address', value: formatAddressHtml(order?.customer), isHtml: true }
    ])}
    ${renderItemsTable(order?.items, 'Total Paid', order?.totalAmount)}
  `);

  const html = renderEmailTemplate({
    subject,
    badgeText: 'Order Received',
    heading: 'We have received your order',
    introLines: [
      `Hi ${customerName}, thank you for shopping with ${BUSINESS_INFO.name}.`,
      'Your order is currently under review.'
    ],
    summaryHtml,
    ctaLabel: 'View Order Details',
    ctaUrl: BUSINESS_INFO.ordersUrl
  });

  return sendEmail(customerEmail, subject, html);
};

/**
 * 2) ORDER CONFIRMED
 * Subject: "Your order is being processed"
 */
export const sendOrderReceivedEmail = async (order) => {
  const subject = 'Your order is being processed';
  const customerName = order?.customer?.name || 'Customer';
  const customerEmail = order?.customer?.email;

  const summaryHtml = renderSummaryBox(`
    ${renderKeyValueTable([
      { label: 'Order Date', value: formatDate(order?.createdAt) },
      { label: 'Delivery Address', value: formatAddressHtml(order?.customer), isHtml: true },
    ])}
    ${renderItemsTable(order?.items, 'Total Amount', order?.totalAmount)}
  `);

  const html = renderEmailTemplate({
    subject,
    badgeText: 'Order Confirmed',
    heading: 'Your order is being processed',
    introLines: [
      `Hi ${customerName}, your order has been confirmed.`,
      'It is currently being prepared and will be dispatched shortly.'
    ],
    summaryHtml,
    ctaLabel: 'Track Your Order',
    ctaUrl: BUSINESS_INFO.ordersUrl
  });

  return sendEmail(customerEmail, subject, html);
};

/**
 * 3) ORDER SHIPPED
 * Subject: "Your order is out for delivery"
 */
export const sendOutForDeliveryEmail = async (order) => {
  const subject = 'Your order is out for delivery';
  const customerName = order?.customer?.name || 'Customer';
  const customerEmail = order?.customer?.email;

  const summaryHtml = renderSummaryBox(`
    ${renderKeyValueTable([
      { label: 'Delivery Address', value: formatAddressHtml(order?.customer), isHtml: true },
    ])}
    ${renderItemsTable(order?.items, 'Total Amount', order?.totalAmount)}
  `);

  const html = renderEmailTemplate({
    subject,
    badgeText: 'Out for Delivery',
    heading: 'Your order is out for delivery',
    introLines: [
      `Hi ${customerName}, your order is out for delivery.`,
      'Please ensure someone is available at the delivery address to receive it.'
    ],
    summaryHtml,
    ctaLabel: 'Contact Support',
    ctaUrl: `mailto:${BUSINESS_INFO.email}`
  });

  return sendEmail(customerEmail, subject, html);
};

/**
 * Existing delivered template (kept for current status flow)
 */
export const sendDeliveredEmail = async (order) => {
  const subject = 'Your order has been delivered';
  const customerName = order?.customer?.name || 'Customer';
  const customerEmail = order?.customer?.email;

  const summaryHtml = renderSummaryBox(`
    ${renderKeyValueTable([
      { label: 'Delivery Address', value: formatAddressHtml(order?.customer), isHtml: true },
    ])}
    ${renderItemsTable(order?.items, 'Total Amount', order?.totalAmount)}
  `);

  const html = renderEmailTemplate({
    subject,
    badgeText: 'Order Delivered',
    heading: 'Your order has been delivered',
    introLines: [
      `Hi ${customerName}, your order has been delivered successfully.`,
      `Thank you for choosing ${BUSINESS_INFO.name}.`
    ],
    summaryHtml,
    ctaLabel: 'View Order Details',
    ctaUrl: BUSINESS_INFO.ordersUrl
  });

  return sendEmail(customerEmail, subject, html);
};

/**
 * 4) ORDER CANCELLED
 * Subject: "Your order update from Sai Lakshmi Home Foods"
 * Note: kept as standalone template function without changing existing status email wiring.
 */
export const sendOrderCancelledEmail = async (order) => {
  const subject = 'Your order update from Sai Lakshmi Home Foods';
  const customerName = order?.customer?.name || 'Customer';
  const customerEmail = order?.customer?.email;

  const summaryHtml = renderSummaryBox(`
    ${renderKeyValueTable([
      { label: 'Delivery Address', value: formatAddressHtml(order?.customer), isHtml: true }
    ])}
    ${renderItemsTable(order?.items, 'Total Amount', order?.totalAmount)}
  `);

  const html = renderEmailTemplate({
    subject,
    badgeText: 'Order Update',
    badgeInverted: true,
    heading: 'Order update',
    introLines: [
      `Hi ${customerName}, here are your order details.`,
      'Please contact support if you need any help.'
    ],
    summaryHtml,
    ctaLabel: 'Contact Support',
    ctaUrl: `mailto:${BUSINESS_INFO.email}`
  });

  return sendEmail(customerEmail, subject, html);
};

/**
 * PRODUCT UPDATE NOTIFICATION
 * Sends email when admin updates product stock/availability
 * Only triggers for stock-related changes
 */
export const sendProductUpdateEmail = async (product, changes) => {
  try {
    if (!product || !product.name) {
      console.error('❌ sendProductUpdateEmail: Invalid product data');
      return { success: false, error: 'Invalid product data' };
    }

    // Extract what changed for subject
    const changeDescriptions = [];
    if (changes.inStock !== undefined) changeDescriptions.push(`is now ${changes.inStock ? 'in stock' : 'out of stock'}`);
    if (changes.stockQuantity !== undefined) changeDescriptions.push(`stock updated to ${changes.stockQuantity || 'unlimited'}`);
    if (changes.pricePerKg !== undefined) changeDescriptions.push(`price updated to ₹${changes.pricePerKg}/kg`);
    if (changes.isActive !== undefined) changeDescriptions.push(`is now ${changes.isActive ? 'active' : 'inactive'}`);

    const subject = `${product.name} Update from Sai Lakshmi Home Foods`;
    const adminEmail = process.env.ADMIN_EMAIL || 'niva2026.in@gmail.com';
    
    // Build info table
    const infoRows = [
      { label: 'Product Name', value: product.name },
      { label: 'Product ID', value: product.productId },
      { label: 'Category', value: product.category || '-' }
    ];

    if (changes.inStock !== undefined) {
      infoRows.push({ label: 'Stock Status', value: changes.inStock ? '✅ In Stock' : '❌ Out of Stock' });
    }
    if (changes.stockQuantity !== undefined) {
      infoRows.push({ label: 'Quantity Available', value: changes.stockQuantity || 'Unlimited' });
    }
    if (changes.pricePerKg !== undefined) {
      infoRows.push({ label: 'Price Per KG', value: `₹${changes.pricePerKg}` });
    }

    const changesSummary = renderKeyValueTable(infoRows);

    const html = renderEmailTemplate({
      subject,
      badgeText: 'Product Update',
      heading: `${product.name} has been updated`,
      introLines: [
        `A product in your store has been updated:`,
        changeDescriptions.join(' • ')
      ],
      summaryHtml: renderSummaryBox(changesSummary),
      ctaLabel: 'View Product',
      ctaUrl: BUSINESS_INFO.website
    });

    // Send to admin
    const result = await sendEmail(adminEmail, subject, html);
    
    if (result.success) {
      console.log(`📧 Product update email sent for: ${product.name}`);
    } else {
      console.error(`📧 Product update email failed for: ${product.name}`, result.error);
    }

    return result;
  } catch (error) {
    console.error('❌ sendProductUpdateEmail error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Test email configuration
 */
export const testEmailConfiguration = async () => {
  const transport = getTransporter();

  if (!transport) {
    return {
      success: false,
      message: 'Email not configured. Set SMTP_USER and SMTP_PASS environment variables.'
    };
  }

  try {
    await transport.verify();
    return { success: true, message: 'Email configuration is valid.' };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

export default {
  sendPaymentConfirmationEmail,
  sendOrderReceivedEmail,
  sendOutForDeliveryEmail,
  sendDeliveredEmail,
  sendOrderCancelledEmail,
  sendProductUpdateEmail,
  testEmailConfiguration
};
