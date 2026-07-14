/**
 * Email Configuration Test Script
 * Run this to verify SMTP settings are working
 */

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

// Load environment variables
dotenv.config();

const testEmailConfig = async () => {
  console.log('\n🔍 Testing Email Configuration...\n');
  
  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log('  SMTP_HOST:', process.env.SMTP_HOST || '❌ Not set');
  console.log('  SMTP_PORT:', process.env.SMTP_PORT || '❌ Not set');
  console.log('  SMTP_USER:', process.env.SMTP_USER || '❌ Not set');
  console.log('  SMTP_PASS:', process.env.SMTP_PASS ? `✅ Set (${process.env.SMTP_PASS.length} chars)` : '❌ Not set');
  console.log('');
  
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('❌ SMTP credentials not configured!\n');
    process.exit(1);
  }
  
  // Create transporter
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  
  try {
    // Test 1: Verify connection
    console.log('🔌 Testing SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection successful!\n');
    
    // Test 2: Send test email
    console.log('📧 Sending test email...');
    const testEmail = await transporter.sendMail({
      from: `"Sai Lakshmi Home Foods Test" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // Send to self
      subject: 'Email Configuration Test - Sai Lakshmi Home Foods',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f4f4;">
          <div style="background: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #800000;">✅ Email Configuration Working!</h1>
            <p>This is a test email from Sai Lakshmi Home Foods backend.</p>
            <p>If you received this, your SMTP configuration is correct.</p>
            <hr>
            <p style="color: #666; font-size: 12px;">
              Time: ${new Date().toLocaleString()}<br>
              Host: ${process.env.SMTP_HOST}<br>
              Port: ${process.env.SMTP_PORT}
            </p>
          </div>
        </div>
      `
    });
    
    console.log(`✅ Test email sent successfully!`);
    console.log(`   Message ID: ${testEmail.messageId}`);
    console.log(`   Check inbox: ${process.env.SMTP_USER}\n`);
    
    console.log('🎉 All tests passed! Email configuration is working.\n');
    
  } catch (error) {
    console.error('\n❌ Email test failed:');
    console.error('   Error:', error.message);
    
    if (error.code === 'EAUTH') {
      console.error('\n💡 Authentication failed. Common issues:');
      console.error('   1. App Password is incorrect or expired');
      console.error('   2. App Password should be 16 characters (no spaces/dashes)');
      console.error('   3. 2-Step Verification must be enabled in Gmail');
      console.error('   4. Generate a new App Password at: https://myaccount.google.com/apppasswords');
    } else if (error.code === 'ECONNECTION') {
      console.error('\n💡 Connection failed. Check:');
      console.error('   1. Internet connection');
      console.error('   2. SMTP_HOST and SMTP_PORT are correct');
      console.error('   3. Firewall/antivirus not blocking port 587');
    }
    
    console.error('');
    process.exit(1);
  }
};

testEmailConfig();
