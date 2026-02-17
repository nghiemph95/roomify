import { Box } from 'lucide-react'
import React from 'react'
import { Button } from './ui/Button'
import { useOutletContext } from 'react-router';

const Navbar = () => {
  const { isSignedIn, userName, userId, refreshAuth, signIn, signOut } = useOutletContext<AuthContext>();
  const handleAuthClick = async () => {
    if (isSignedIn) {
      await signOut();
    } else {
      await signIn();
    }

    await refreshAuth();
  }

  return (
    <header className='navbar'>
      <nav className='inner'>
        <div className='left'>
          <div className='brand'>
            <Box className='logo' />

            <span className='name'>Roomify</span>
          </div>

          <ul className='links'>
            <a href='#'>Product</a>
            <a href='#'>Pricing</a>
            <a href='#'>Community</a>
            <a href='#'>Enterprise</a>
          </ul>
        </div>

        <div className='actions'>
          {isSignedIn ? (
            <>
              <span className='greeting'>{userName ? `Welcome, ${userName}` : 'Sign in to your account'}</span>

              <Button size='sm' onClick={handleAuthClick} className='btn'>Log out</Button>
            </>
          ) : (
            <>
              <Button onClick={handleAuthClick} size='sm' variant='ghost'>Log in </Button>

              <a href='#' className='cta'>Get Started</a>
            </>

          )}

        </div>

      </nav>
    </header>
  )
}

export default Navbar