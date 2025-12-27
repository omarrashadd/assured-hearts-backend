require('dotenv').config();
const { createProviderUser, insertProviderApplication, init } = require('./src/db');

const testProviders = [
  {
    name: 'Fatima Khan',
    email: 'fatima.calgary@example.com',
    phone: '403-555-0101',
    password: 'test1234',
    city: 'Calgary',
    province: 'AB',
    experience: '7 years working with infants and toddlers',
    certifications: 'First Aid, CPR, Montessori Certificate'
  },
  {
    name: 'Ahmed Hassan',
    email: 'ahmed.calgary@example.com',
    phone: '403-555-0102',
    password: 'test1234',
    city: 'Calgary',
    province: 'AB',
    experience: '4 years experience with school-age children',
    certifications: 'First Aid, CPR, Bachelor of Education'
  },
  {
    name: 'Mariam Ali',
    email: 'mariam.regina@example.com',
    phone: '306-555-0201',
    password: 'test1234',
    city: 'Regina',
    province: 'SK',
    experience: '6 years working with children ages 1-10',
    certifications: 'First Aid, CPR, Early Childhood Education Diploma'
  },
  {
    name: 'Yusuf Ibrahim',
    email: 'yusuf.regina@example.com',
    phone: '306-555-0202',
    password: 'test1234',
    city: 'Regina',
    province: 'SK',
    experience: '3 years of childcare experience, bilingual (English/Arabic)',
    certifications: 'First Aid, CPR'
  },
  {
    name: 'Aisha Rahman',
    email: 'aisha.toronto@example.com',
    phone: '416-555-0301',
    password: 'test1234',
    city: 'Toronto',
    province: 'ON',
    experience: '8 years working with children of all ages, specializing in special needs',
    certifications: 'First Aid, CPR, Special Education Certificate, ECE Diploma'
  }
];

async function seed() {
  try {
    console.log('Initializing database...');
    await init();
    
    console.log('Seeding test providers...');
    
    for (const provider of testProviders) {
      const { name, email, phone, password, city, province, experience, certifications } = provider;
      
      try {
        const userId = await createProviderUser({ name, email, phone, password, city, province });
        console.log(`✓ Created provider user: ${name} (ID: ${userId})`);
        
        await insertProviderApplication({
          user_id: userId,
          experience,
          certifications,
          availability: null,
          age_groups: null
        });
        console.log(`  ✓ Added application for ${name}`);
        
      } catch (err) {
        if (err.code === '23505') {
          console.log(`  ⚠ Skipped ${name} - email already exists`);
        } else {
          console.error(`  ✗ Error creating ${name}:`, err.message);
        }
      }
    }
    
    console.log('\n✅ Seeding complete!');
    console.log('Test credentials for all providers: password "test1234"');
    process.exit(0);
    
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
