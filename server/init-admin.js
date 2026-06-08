import bcrypt from 'bcrypt';
import { supabase } from './config/supabase.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script para crear el admin superior inicial
 * Ejecutar una sola vez: node init-admin.js
 */

async function initAdminSuperior() {
  try {
    const email = process.env.ADMIN_EMAIL || 'administracion@ranusedesign.com';
    const password = process.env.ADMIN_PASSWORD || 'RanuseAdmin2024';

    console.log('🔐 Creando admin superior...');
    console.log('📧 Email:', email);

    // Verificar si ya existe
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      console.log('⚠️  El admin superior ya existe');
      console.log('ID:', existingUser.id);
      return;
    }

    // Hashear contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insertar en base de datos
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        role: 'admin_superior',
        created_by: null // Es el primer usuario
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log('✅ Admin superior creado exitosamente');
    console.log('ID:', data.id);
    console.log('Email:', data.email);
    console.log('Role:', data.role);
    console.log('\n📝 GUARDA ESTAS CREDENCIALES:');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('\n⚠️  IMPORTANTE: Cambia la contraseña después del primer login\n');

  } catch (error) {
    console.error('❌ Error al crear admin superior:', error.message);
    process.exit(1);
  }
}

initAdminSuperior();