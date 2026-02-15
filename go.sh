git add .

# echo 'Enter the commit message'

currentDate="$(date +'%d-%m-%Y %H:%M:%S')"
msg="Updated: $currentDate"
git commit -m "$msg" # Updated: 2019-08-28 10:22:06

# echo 'Enter the git pushing source code:'
# read push

git push

exit
